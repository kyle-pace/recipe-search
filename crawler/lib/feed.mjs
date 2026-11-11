// Reads an RSS feed (Substack's /feed, and the same shape from Ghost, Beehiiv and
// WordPress): one request gives the newest posts, each with its public text. Posts
// behind a paywall arrive cut off at the paywall, so we only ever see what any
// visitor sees.

import { clean, decodeEntities } from './text.mjs';

export function parseFeed(xml) {
  const text = String(xml || '');
  if (!/<rss[\s>]/i.test(text)) throw new Error('not an RSS feed');
  const items = [];
  for (const m of text.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
    const item = m[1];
    const link = normalizeLink(field(item, 'link') || field(item, 'guid'));
    const title = clean(field(item, 'title'));
    if (!link || !title) continue;
    const date = new Date(field(item, 'pubDate') || '');
    items.push({
      title,
      link,
      date: Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10),
      image: enclosureImage(item),
      html: field(item, 'content:encoded') || field(item, 'description') || '',
    });
  }
  return items;
}

// A tag's text, with or without CDATA. Feed readers get HTML escaped once when there's no CDATA.
function field(item, tag) {
  const m = item.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  if (!m) return '';
  const cdata = m[1].match(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/);
  return cdata ? cdata[1] : decodeEntities(m[1].trim());
}

function enclosureImage(item) {
  for (const m of item.matchAll(/<enclosure\b[^>]*>/gi)) {
    if (!/type=["']image\//i.test(m[0])) continue;
    const url = m[0].match(/url=["']([^"']+)["']/i);
    if (url) return decodeEntities(url[1]);
  }
  return null;
}

// Tracking parameters and fragments go; the post's own address stays.
function normalizeLink(u) {
  try {
    const x = new URL(u.trim());
    if (x.protocol !== 'https:' && x.protocol !== 'http:') return null;
    x.search = '';
    x.hash = '';
    return x.href;
  } catch {
    return null;
  }
}
