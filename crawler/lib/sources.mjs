// Recipe search's view of the recipe sources. The list itself lives in KitchenCatalog
// (recipe-sources/sources.json, vendored to vendor/kitchen-catalog/sources.json by
// npm run sync-catalog); this turns it into what the crawler and the index builder use.
// Only vetted sources count; suggestions waiting for Kyle's review are left out.
//
//   recipes:   sites to crawl (collect.status crawl) or skip for now (paused, with the reason)
//   videos:    every YouTube channel; `site` ties it to its creator's crawled or paused site
//   link_only: sources offered as a link to their own search
//   support:   ways to support each creator, by creator id (a site's id, or a channel's own id)
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSources, validateSources } from '../../vendor/kitchen-catalog/sources.mjs';

export const SOURCES_FILE = join(dirname(fileURLToPath(import.meta.url)), '../../vendor/kitchen-catalog/sources.json');

export function readSources(file = SOURCES_FILE) {
  const data = loadSources(file);
  const problems = validateSources(data);
  if (problems.length) throw new Error(`${file} has problems:\n${problems.join('\n')}`);
  return adapt(data.sources.filter((s) => s.vetted));
}

export function adapt(list) {
  const recipes = list
    .filter((s) => s.crawl && ['crawl', 'paused'].includes(s.collect.status))
    .map((s) => {
      const { sitemap, include, format, default_cuisine, delay_seconds, photos } = s.crawl;
      return clean({
        id: s.id,
        name: s.name,
        site: s.url,
        sitemap,
        include,
        format,
        default_cuisine,
        delay_seconds,
        photos,
        paused: s.collect.status === 'paused' ? s.collect.reason : undefined,
      });
    });
  const crawled = new Set(recipes.map((r) => r.id));

  const videos = [];
  for (const s of list) {
    if (s.kind === 'channel') videos.push({ id: s.id, name: s.name, channel: s.url });
    else if (s.youtube) videos.push(clean({ id: s.youtube.id, name: s.name, site: crawled.has(s.id) ? s.id : undefined, channel: s.youtube.url }));
  }

  // Sites' own searches first, then searches on YouTube (Kenji's backstop).
  const onYouTube = (l) => /youtube\.com/.test(l.search);
  const link_only = list
    .filter((s) => s.search)
    .map((s) => clean({ name: s.search_label || s.name, search: s.search, reason: s.search_note || s.collect.reason }))
    .sort((a, b) => Number(onYouTube(a)) - Number(onYouTube(b)));

  // A creator is a site (with or without its channel), or a channel alone.
  const support = {};
  for (const s of list) {
    if (!s.support) continue;
    const creator = crawled.has(s.id) ? s.id : s.youtube?.id || s.id;
    support[creator] = { links: s.support.links || [], books: s.support.books || [] };
  }
  return { recipes, videos, link_only, support };
}

const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
