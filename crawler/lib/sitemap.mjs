// Sitemap reading: an index of sitemaps or a plain urlset, gzipped or not.

import { gunzipSync } from 'node:zlib';
import { decodeEntities } from './text.mjs';

export function parseSitemap(xml) {
  const text = String(xml || '');
  const isIndex = /<sitemapindex[\s>]/i.test(text);
  const entries = [];
  const block = isIndex ? 'sitemap' : 'url';
  const re = new RegExp(`<${block}\\b[^>]*>([\\s\\S]*?)</${block}>`, 'gi');
  for (const m of text.matchAll(re)) {
    const loc = m[1].match(/<loc>\s*(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?\s*<\/loc>/i);
    if (!loc) continue;
    const lastmod = m[1].match(/<lastmod>\s*([\s\S]*?)\s*<\/lastmod>/i);
    entries.push({ loc: decodeEntities(loc[1].trim()), lastmod: lastmod ? lastmod[1].trim() : null });
  }
  return { isIndex, entries };
}

// Child sitemaps that never hold posts or recipes.
const SKIP_CHILD = /(category|tag|author|attachment|page-sitemap|product|web-?stor|wprm_|course|cuisine|keyword|ingredient|collection|format|portfolio|video-sitemap|image-sitemap|news-sitemap|local-sitemap)/i;

export async function readSitemaps(startUrl, fetchText, { include, depth = 0, log = () => {} } = {}) {
  const body = await fetchText(startUrl, { binary: startUrl.endsWith('.gz') });
  const xml = Buffer.isBuffer(body) ? gunzipSync(body).toString('utf8') : body;
  const { isIndex, entries } = parseSitemap(xml);
  if (!isIndex) {
    return entries.filter((e) => !include || include.test(e.loc));
  }
  if (depth > 2) return [];
  const out = [];
  for (const child of entries) {
    if (SKIP_CHILD.test(child.loc)) continue;
    try {
      out.push(...(await readSitemaps(child.loc, fetchText, { include, depth: depth + 1, log })));
    } catch (err) {
      log(`  sitemap ${child.loc} failed: ${err.message}`);
      throw err; // a missing child sitemap must not look like deleted recipes
    }
  }
  return out;
}
