// Builds the search index the page loads: public/recipe-search/index.json.
// Reads what the crawler kept (data/<id>.json) and matches every ingredient line to a
// KitchenCatalog id (vendor/kitchen-catalog), so "scallions" and "green onion" find the
// same recipes. Runs before every build (npm run build), so each weekly crawl that
// lands on main ships a fresh index.
//
//   node scripts/build-index.mjs            # writes the index
//   node scripts/build-index.mjs --report   # also lists the most common unmatched lines
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { load, match } from '../vendor/kitchen-catalog/catalog.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'public/recipe-search/index.json');
const report = process.argv.includes('--report');

const sources = parse(readFileSync(join(root, 'sources.yaml'), 'utf8'));
const catalog = load(join(root, 'vendor/kitchen-catalog/catalog.json'));
const status = JSON.parse(readFileSync(join(root, 'data/status.json'), 'utf8'));

const decode = (s) =>
  String(s)
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&(amp|quot|apos|#039|lt|gt|nbsp|rsquo|lsquo|ldquo|rdquo|ndash|mdash|hellip);/g, (_, e) =>
      ({ amp: '&', quot: '"', apos: "'", '#039': "'", lt: '<', gt: '>', nbsp: ' ', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', ndash: '–', mdash: '—', hellip: '…' })[e],
    )
    .replace(/\s+/g, ' ')
    .trim();

const minutes = (t) => {
  if (t == null || t === '') return null;
  if (typeof t === 'number') return t > 0 ? Math.round(t) : null;
  if (/^\d+$/.test(t)) return Number(t) || null;
  const m = String(t).match(/P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?/);
  const n = m ? Number(m[1] || 0) * 1440 + Number(m[2] || 0) * 60 + Number(m[3] || 0) : 0;
  return n || null;
};

// Cuisine labels as the sites write them, folded into the names people would pick.
const CUISINE = {
  'american/chinese': 'Chinese American',
  'chinese american': 'Chinese American',
  'chinese-american': 'Chinese American',
  'thai fusion': 'Thai',
  'thai-inspired': 'Thai',
  'asian fusion': 'Asian',
  'southeast asian': 'Asian',
  'western': 'American',
  'north american': 'American',
};
const cuisineOf = (c, fallback) => {
  const raw = decode(c || fallback || '').split(/[,;|]/)[0].trim();
  if (!raw) return '';
  const key = raw.toLowerCase();
  if (CUISINE[key]) return CUISINE[key];
  return raw
    .split('/')[0]
    .trim()
    .replace(/\b\w/g, (ch) => ch.toUpperCase())
    .replace(/ Cuisine$/, '');
};

// An item and everything it's a kind of: pork belly is also pork, so "pork" finds it.
const withParents = (id) => {
  const ids = [id];
  for (let p = catalog.items[id]?.parent, n = 0; p && n < 10; p = catalog.items[p]?.parent, n++) ids.push(p);
  return ids;
};

// Pantry basics everyone has: still matched, but not offered as ingredient suggestions or
// counted as "missing", so "uses 3 of 3" isn't spoiled by salt.
const BASICS = new Set(['salt', 'kosher-salt', 'sea-salt', 'water', 'black-pepper', 'white-pepper', 'vegetable-oil', 'cooking-oil', 'oil', 'neutral-oil', 'ice']);

const srcList = [];
const ingIndex = new Map(); // id -> position in ing[]
const ing = []; // [id, name, recipeCount, parent positions, ...other names]
const cuisineCount = new Map();
const recipes = [];
const unmatched = new Map();
let lines = 0;
let matched = 0;

const ingPos = (id) => {
  if (!ingIndex.has(id)) {
    const item = catalog.items[id];
    ingIndex.set(id, ing.length);
    const names = [...new Set([item.name, ...(item.aliases || [])].map((n) => n.toLowerCase()))];
    ing.push([id, item.name, 0, [], ...names.filter((n) => n !== item.name.toLowerCase())]);
  }
  return ingIndex.get(id);
};

for (const s of sources.recipes) {
  const file = join(root, 'data', `${s.id}.json`);
  if (!existsSync(file)) continue;
  const rows = JSON.parse(readFileSync(file, 'utf8'));
  if (!rows.length) continue;
  const site = s.site.replace(/\/$/, '');
  const srcIdx = srcList.length;
  srcList.push({ id: s.id, name: s.name, site, host: new URL(site).hostname.replace(/^www\./, ''), count: 0 });

  for (const r of rows) {
    const ids = new Set();
    const direct = new Set();
    for (const line of r.i || []) {
      lines++;
      const m = match(catalog, line);
      if (m && !catalog.items[m.id].product) {
        matched++;
        direct.add(m.id);
        for (const id of withParents(m.id)) ids.add(id);
      } else if (report) {
        const k = String(line).toLowerCase();
        unmatched.set(k, (unmatched.get(k) || 0) + 1);
      }
    }
    // Older posts with no ingredient list: fall back to what the title and keywords name.
    if (!direct.size) {
      for (const text of [r.n, ...(r.kw || [])]) {
        const m = match(catalog, decode(text));
        if (m && !catalog.items[m.id].product) {
          direct.add(m.id);
          for (const id of withParents(m.id)) ids.add(id);
        }
      }
    }
    const cuisine = cuisineOf(r.c, s.default_cuisine);
    if (cuisine) cuisineCount.set(cuisine, (cuisineCount.get(cuisine) || 0) + 1);
    const pos = [...ids].map(ingPos);
    for (const id of direct) if (!BASICS.has(id)) ing[ingPos(id)][2]++;
    // Which of the positions were named by the recipe itself (the rest are parents),
    // and how many non-basic ingredients it has, for "uses 2 of your 3" and "missing 1".
    const own = [...direct].filter((id) => !BASICS.has(id)).map(ingPos);
    const url = r.u.startsWith(site) ? r.u.slice(site.length) : r.u;
    const name = decode(r.n);
    const kw = (r.kw || []).map(decode).filter((k) => k.toLowerCase() !== name.toLowerCase());
    // Smaller photos where the host can resize (WordPress.com's image CDN takes ?w=).
    let img = s.photos === false ? '' : r.img || '';
    if (img.startsWith('https://i0.wp.com/')) img = img.replace(/\?.*$/, '') + '?w=480&quality=80&ssl=1';
    recipes.push([srcIdx, name, url, minutes(r.t), cuisine, pos, own, img, kw.join(' · ')]);
    srcList[srcIdx].count++;
  }
}

// Videos from the YouTube Data API, once the key is in place (crawler/lib/youtube.mjs).
const videos = [];
for (const v of sources.videos || []) {
  const file = join(root, 'data', `${v.id}.json`);
  if (!existsSync(file)) continue;
  const rows = JSON.parse(readFileSync(file, 'utf8'));
  for (const row of rows) {
    const ids = new Set();
    const m = match(catalog, decode(row.n));
    if (m && !catalog.items[m.id].product) for (const id of withParents(m.id)) ids.add(id);
    videos.push([v.name, decode(row.n), row.id, row.p || '', [...ids].map(ingPos)]);
  }
}

// Each ingredient's parents, so "pork" chosen covers pork belly in "uses 2 of your 3".
for (const entry of ing) entry[3] = withParents(entry[0]).slice(1).filter((id) => ingIndex.has(id)).map((id) => ingIndex.get(id));

// "Start with what you have": the things people actually have on hand (produce, meat,
// seafood, eggs and dairy), most used first. Meat and seafood roll up to the general item
// (chicken, not chicken thighs). Vague or pantry-staple items are left out.
const NOT_POPULAR = new Set(['fresh-herbs', 'lemons-and-limes', 'butter', 'milk', 'heavy-whipping-cream', 'garlic-and-onions']);
const SECTIONS = new Set(['produce', 'meat', 'seafood', 'dairy-eggs']);
const rollup = ing.map(() => 0);
for (const r of recipes) for (const p of r[5]) rollup[p]++;
const popular = ing
  .map((g, p) => ({ p, id: g[0], n: rollup[p], item: catalog.items[g[0]] }))
  .filter(({ id, item, n }) => n >= 15 && SECTIONS.has(item.section) && !NOT_POPULAR.has(id))
  .filter(({ item }) => !(['meat', 'seafood'].includes(item.section) && item.parent && ingIndex.has(item.parent)))
  .sort((a, b) => b.n - a.n)
  .slice(0, 18)
  .map(({ p }) => p);

const cuisines = [...cuisineCount].filter(([, n]) => n >= 5).sort((a, b) => b[1] - a[1]);

const paused = sources.recipes
  .filter((s) => s.paused || !srcList.some((x) => x.id === s.id))
  .map((s) => ({ name: s.name, site: s.site, why: s.paused ? 'paused' : 'not indexed yet' }));

const index = {
  built: new Date().toISOString().slice(0, 10),
  crawled: (status.run || '').slice(0, 10),
  sources: srcList,
  paused,
  videos: { sources: (sources.videos || []).map((v) => ({ name: v.name, channel: v.channel })), rows: videos },
  linkOnly: (sources.link_only || []).map((l) => ({ name: l.name, search: l.search })),
  cuisines,
  popular,
  ing,
  recipes,
};

mkdirSync(dirname(out), { recursive: true });
const json = JSON.stringify(index);
writeFileSync(out, json);
console.log(
  `index: ${recipes.length} recipes from ${srcList.length} sites, ${videos.length} videos, ${ing.length} ingredients, ` +
    `${cuisines.length} cuisines; ${Math.round((matched / lines) * 100)}% of ingredient lines matched; ${Math.round(json.length / 1024)} KB`,
);
if (report) {
  console.log('Most common unmatched lines:');
  for (const [k, n] of [...unmatched].sort((a, b) => b[1] - a[1]).slice(0, 60)) console.log(String(n).padStart(4), k);
}
