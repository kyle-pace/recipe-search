// Recipe search, in the browser. Loads the index once (about 290 KB over the wire), then
// every keystroke searches it locally: no server, no search service, nothing typed ever
// leaves the page.
//
// One search box (#q). Words you type search recipe names, ingredients and cuisines.
// Picking an ingredient or a creator from the suggestions turns it into a tag in the box:
// ingredient tags rank recipes by how many of them they use, creator tags narrow to that
// creator's recipes and videos. With nothing searched, the page is just the box (home);
// after a search, the box moves up and results fill the page (results).
// State lives in the URL (?q=, &with=, &site=, &time=, &cuisine=), so searches can be
// shared and the back button works. (`site` holds creator ids, for older links.)
import { track } from 'kp-design/analytics';

type Source = { id: string; name: string; site: string; host: string; count: number };
// [catalog id, name, recipes naming it, parent positions, ...other names]
type Ing = [string, string, number, number[], ...string[]];
// [source, name, url (path on the site), minutes, cuisine, ingredient positions (with parents), own positions, photo, keywords, opens lately]
type RecipeRow = [number, string, string, number | null, string, number[], number[], string, string, number?];
// [channel index, title, video id, published date, ingredient positions]
type VideoRow = [number, string, string, string, number[]];
type Channel = { id: string; name: string; channel: string; site: string; count: number };
type Index = {
  built: string;
  crawled: string;
  sources: Source[];
  paused: { id: string; name: string; site: string; why: string }[];
  videos: { sources: Channel[]; rows: VideoRow[] };
  /** Ways to support each creator, by creator id (from KitchenCatalog's recipe sources). */
  support: Record<string, { label: string; url: string; book?: boolean }[]>;
  linkOnly: { name: string; search: string }[];
  cuisines: [string, number][];
  popular: number[];
  /** Ingredient positions a vegetarian or vegan search leaves out. */
  diet?: { vegetarian: number[]; vegan: number[] };
  ing: Ing[];
  recipes: RecipeRow[];
};

/** Whoever made it: a site, a site and its channel, or a channel alone. */
type Creator = { id: string; name: string; recipes: number; videos: number; words: string[] };

type Recipe = {
  i: number;
  src: Source;
  name: string;
  url: string;
  min: number | null;
  cuisine: string;
  pos: Set<number>;
  own: number[];
  img: string;
  /** "woks:/mapo-tofu/": the recipe's id in analytics and in data/popularity.json. */
  key: string;
  /** Opens in the last 90 days, across everyone (counts only). */
  opens: number;
  title: string[];
  titleText: string;
  other: string[];
};

type Hit = { r: Recipe; score: number; used: number[]; missing: number };

const EXPERIMENT = 'recipe-search';
const PAGE = 24;
const TIMES = [15, 30, 45, 60];
const TRY = ['mapo tofu', 'pad thai', 'dumplings', 'green curry', 'fried rice', 'scones'];
const POPULAR_SHOWN = 5;

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const page = $('page');
const app = $('app');
const form = $<HTMLFormElement>('search-form');
const qInput = $<HTMLInputElement>('q');
const statusEl = $('status');
const resultsEl = $<HTMLOListElement>('results');
const moreBtn = $<HTMLButtonElement>('more');

const esc = (s: unknown) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const plural = (n: number, one: string, many = one + 's') => `${n.toLocaleString()} ${n === 1 ? one : many}`;
const fmtTime = (m: number) =>
  m < 60 ? plural(m, 'minute') : `${plural(Math.floor(m / 60), 'hour')}${m % 60 ? ` ${plural(m % 60, 'minute')}` : ''}`;
/** "a, b and c" */
const andList = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);
const orList = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} or ${xs.at(-1)}`);

/** "Scallions, chopped!" -> ["scallion", "chopped"]: lowercase, no accents, singular words. */
function words(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[’']/g, '')
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map((w) =>
      w.length <= 3 || /(ss|us|is)$/.test(w)
        ? w
        : w.endsWith('ies')
          ? w.slice(0, -3) + 'y'
          : /(oes|ches|shes|xes)$/.test(w)
            ? w.slice(0, -2)
            : w.endsWith('s')
              ? w.slice(0, -1)
              : w,
    );
}

let data: Index;
let recipes: Recipe[] = [];
let creators: Creator[] = [];
const creatorById = new Map<string, Creator>();
let ingNames: string[][] = []; // per position: its names, as words joined by spaces
let ingRecipes: number[] = []; // per position: how many recipes use it (directly or as a kind of it)
const ingById = new Map<string, number>();

const state = {
  q: '',
  with: [] as number[],
  sites: new Set<string>(), // creator ids
  time: 0,
  cuisine: '',
  show: '' as '' | 'recipes' | 'videos', // both, or just one kind
  without: [] as number[], // ingredients to leave out ("no pork")
  notWords: [] as string[], // words to leave out by title, for things that aren't one ingredient ("no peas")
  diet: '' as '' | 'vegetarian' | 'vegan',
  exact: false, // search the words as typed, without fixing typos
  shown: PAGE,
  picked: -1, // a recipe picked at random, by index into recipes
};

/** The creator a channel belongs to: its site's id, or its own. */
const creatorOfChannel = (k: number) => data.videos.sources[k].site || data.videos.sources[k].id;

// ---------------------------------------------------------------------------------------
// Loading

async function load() {
  try {
    const res = await fetch('/recipe-search/index.json');
    if (!res.ok) throw new Error(String(res.status));
    data = await res.json();
  } catch {
    statusEl.textContent = 'The recipes didn’t load. Refresh the page to try again.';
    return;
  }
  buildCreators();
  ingNames = data.ing.map((g) => [g[1], ...(g.slice(4) as string[])].map((n) => words(n).join(' ')));
  data.ing.forEach((g, p) => ingById.set(g[0], p));
  ingRecipes = data.ing.map(() => 0);
  recipes = data.recipes.map((row, i) => {
    const [s, name, url, min, cuisine, pos, own, img, kw, opens = 0] = row;
    const src = data.sources[s];
    for (const p of pos) ingRecipes[p]++;
    const title = words(name);
    const other = [
      ...words(kw),
      ...words(cuisine),
      ...words(src.name),
      ...pos.flatMap((p) => ingNames[p].join(' ').split(' ')),
    ];
    return {
      i,
      src,
      name,
      url: url.startsWith('http') ? url : src.site + url,
      min,
      cuisine,
      pos: new Set(pos),
      own,
      img,
      key: `${src.id}:${url}`,
      opens,
      title,
      titleText: ` ${title.join(' ')} `,
      other: [...new Set(other)],
    };
  });
  buildVocab();
  buildFilters();
  buildStart();
  readUrl();
  app.dataset.state = 'ready';
  render();
}

function buildCreators() {
  const add = (id: string, name: string) => {
    let c = creatorById.get(id);
    if (!c) {
      c = { id, name, recipes: 0, videos: 0, words: words(name) };
      for (const a of CREATOR_ALIASES[id] || []) c.words.push(...words(a).filter((w) => !c!.words.includes(w)));
      creatorById.set(id, c);
      creators.push(c);
    }
    return c;
  };
  for (const s of data.sources) add(s.id, s.name).recipes = s.count;
  for (const s of data.paused) add(s.id, s.name);
  data.videos.sources.forEach((ch, k) => (add(creatorOfChannel(k), ch.name).videos += ch.count));
  creators = creators.filter((c) => c.recipes || c.videos);
}

// ---------------------------------------------------------------------------------------
// Understanding the words. Two layers, both in the browser:
// - queryWords: what the search matches on. Filler ("easy", "recipe", "how to make") is
//   ignored, and a word the index has never seen is swapped for the closest one it has
//   ("dumpligns" -> "dumpling"), unless you asked for exactly what you typed.
// - understand: on Enter, plain phrases become tags and filters you can see and remove:
//   "under 30 minutes", "quick", "with tofu and eggs", "no pork", "vegetarian", "from
//   Maangchi".

const STOP = new Set(
  ('a an the and or of for to in on my me i im want wanna need make making made cook cooking cooked how what can should ' +
    'recipe recipes easy easiest simple best good great tasty yummy delicious perfect ultimate authentic classic traditional ' +
    'homemade home style version idea ideas some something dish dishes food meal meals tonight today please really very ' +
    'quick quickly fast speedy weeknight dinner dinners lunch supper with using without no from by').split(' '),
);
// Other names people use for a creator ("pailin" for Hot Thai Kitchen).
const CREATOR_ALIASES: Record<string, string[]> = {
  htk: ['pailin', 'pailins kitchen'],
  kenji: ['kenji'],
  rte: ['nagi', 'recipe tin', 'recipetin'],
  rtj: ['yumiko'],
  mwl: ['daddy lau', 'lau'],
  sk: ['smitten', 'deb perelman'],
  ccd: ['ccd'],
  fca: ['french cooking'],
  ab: ['alton', 'good eats'],
};

const vocab = new Map<string, number>(); // every word in the index, with how often it appears

function buildVocab() {
  const add = (ws: string[]) => ws.forEach((w) => vocab.set(w, (vocab.get(w) || 0) + 1));
  for (const r of recipes) add([...r.title, ...r.other]);
  for (const v of data.videos.rows) add(words(v[1]));
}

/** Edit distance, giving up past `max` (letters swapped count as one edit). */
function distance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev2: number[] = [];
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) cur[j] = Math.min(cur[j], prev2[j - 2] + 1);
      best = Math.min(best, cur[j]);
    }
    if (best > max) return max + 1;
    prev2 = prev;
    prev = cur;
  }
  return prev[b.length];
}

/** The closest word the index knows, if one is close enough to be a typo. */
function closest(w: string): string {
  if (w.length < 4 || /\d/.test(w)) return '';
  const max = w.length >= 7 ? 2 : 1;
  let best = '';
  let bestD = max + 1;
  let bestN = 0;
  for (const [v, n] of vocab) {
    if (v.length < 3) continue;
    const d = distance(w, v, max);
    if (d < bestD || (d === bestD && n > bestN)) [best, bestD, bestN] = [v, d, n];
  }
  return bestD <= max ? best : '';
}

const queryCache = new Map<string, { words: string[]; fixes: [string, string][] }>();

function queryWords(text: string, exact = state.exact) {
  const key = `${exact ? 1 : 0}|${text}`;
  const hit = queryCache.get(key);
  if (hit) return hit;
  const all = words(text);
  const kept = all.filter((w) => !STOP.has(w));
  const ws = kept.length ? kept : all;
  const fixes: [string, string][] = [];
  const out = ws.map((w, n) => {
    if (exact || !vocab.size || vocab.has(w)) return w;
    // The last word may still be being typed: a prefix of a known word is fine.
    if (n === ws.length - 1 && [...vocab.keys()].some((v) => v.startsWith(w))) return w;
    const fix = closest(w);
    if (!fix) return w;
    fixes.push([w, fix]);
    return fix;
  });
  const result = { words: out, fixes };
  queryCache.set(key, result);
  return result;
}

type Understood = {
  q: string;
  time: number;
  with: number[];
  without: number[];
  notWords: string[];
  sites: string[];
  diet: '' | 'vegetarian' | 'vegan';
};

/**
 * The ingredient a phrase names exactly (any of its names, singular or plural). Only an
 * exact name: a guess like "peas" -> peanuts would quietly leave the wrong recipes out.
 */
function ingredientFor(phrase: string, mainName = false): number | null {
  const qs = words(phrase).join(' ');
  if (!qs) return null;
  return (
    data.ing
      .map((_, p) => p)
      .find((p) => ingRecipes[p] > 0 && (mainName ? ingNames[p][0] === qs : ingNames[p].some((n) => n === qs))) ?? null
  );
}

/** The longest run of words at the start of a phrase that names an ingredient: "chicken thighs tonight" -> chicken thighs. */
function takeIngredient(phrase: string, mainName = false): { p: number | null; meat: boolean; rest: string } {
  const ws = phrase.trim().split(/\s+/).filter(Boolean);
  if (/^meats?$/.test(ws[0] || '')) return { p: null, meat: true, rest: ws.slice(1).join(' ') };
  for (let k = Math.min(3, ws.length); k >= 1; k--) {
    const p = ingredientFor(ws.slice(0, k).join(' '), mainName);
    if (p != null) return { p, meat: false, rest: ws.slice(k).join(' ') };
  }
  return { p: null, meat: false, rest: phrase };
}

function creatorFor(phrase: string): string | null {
  const qs = words(phrase).join(' ');
  if (!qs) return null;
  const c = creators.find(
    (c) => c.words.join(' ') === qs || (CREATOR_ALIASES[c.id] || []).some((a) => words(a).join(' ') === qs),
  );
  return c?.id ?? null;
}

function understand(text: string): Understood {
  const out: Understood = { q: '', time: 0, with: [], without: [], notWords: [], sites: [], diet: '' };
  // Lowercase, no accents or apostrophes, hyphens as spaces ("pork-free", "López-Alt").
  let t = ` ${text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’']/g, '')
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')} `;
  const cut = (re: RegExp) => (t = t.replace(re, ' '));

  // Time: "under 30 minutes", "in 20 min", "1 hour", "30-minute"; or just "quick".
  const time = t.match(/\b(?:under|less than|in|within|at most|max|no more than|up to)?\s*(\d+(?:\.\d+)?)[\s-]*(minutes?|mins?|m|hours?|hrs?|h)\b/);
  if (time) {
    const n = Number(time[1]) * (/^h/.test(time[2]) ? 60 : 1);
    if (n > 0 && n <= 600) out.time = Math.round(n);
    t = t.replace(time[0], ' ');
  } else if (/\b(quick|quickly|fast|speedy)\b/.test(t)) out.time = 30;

  // Diet.
  if (/\b(vegan|plant[\s-]based)\b/.test(t)) out.diet = 'vegan';
  else if (/\b(vegetarian|veggie|meatless|meat[\s-]free)\b/.test(t)) out.diet = 'vegetarian';
  cut(/\b(vegan|plant[\s-]based|vegetarian|veggie|meatless|meat[\s-]free)\b/g);

  // "No-bake cookies" and friends are dishes, not leaving something out.
  t = t.replace(/\bno (bake|knead|churn|cook|boil)\b/g, 'no$1');

  // Leave out: "no pork", "without peanuts or shrimp", "pork-free".
  const stop = String.raw`(?=\s*(?:,|\bwith\b|\busing\b|\bunder\b|\bin\b|\bfor\b|\bfrom\b|$))`;
  t = t.replace(new RegExp(String.raw`\b(?:without|no|minus|skip|hold the|not)\s+([a-z][a-z \-]*?(?:\s*(?:,|and|or)\s*[a-z][a-z \-]*?)*)` + stop, 'g'), (all, list: string) => {
    let kept = '';
    for (const piece of list.split(/\s*(?:,|\band\b|\bor\b)\s*/)) {
      // "no meat" means vegetarian; there's no single "meat" ingredient to leave out.
      // Leave out an ingredient only when the words are its main name: "cilantro" is
      // filed under fresh herbs, and leaving out every herb isn't what was asked.
      const { p, meat, rest } = takeIngredient(piece, true);
      if (meat) out.diet ||= 'vegetarian';
      else if (p != null) out.without.push(p);
      else {
        // Not an ingredient by that name: leave out recipes with the word in their name.
        const w = piece.trim().split(/\s+/)[0];
        if (w && !STOP.has(words(w)[0] || '')) out.notWords.push(w);
        kept += ` ${piece.split(/\s+/).slice(1).join(' ')}`;
        continue;
      }
      kept += ` ${rest}`;
    }
    return kept ? ` ${kept} ` : ' ';
  });
  t = t.replace(/\b([a-z]+)[\s-]free\b/g, (all, w: string) => {
    const p = ingredientFor(w, true);
    if (p == null) return all;
    out.without.push(p);
    return ' ';
  });

  // Creators: a creator's name anywhere, with or without "from" ("kenji fried rice", "from maangchi").
  for (const c of creators) {
    for (const name of [c.words.join(' '), ...(CREATOR_ALIASES[c.id] || []).map((a) => words(a).join(' '))]) {
      if (name.length < 3) continue;
      const re = new RegExp(`\\b(?:(?:from|by)\\s+)?${name.replace(/ /g, '\\s+')}s?\\b`);
      if (re.test(t)) {
        out.sites.push(c.id);
        t = t.replace(re, ' ');
        break;
      }
    }
  }

  // Ingredients: "with tofu and eggs", "using leftover rice", "i have chicken, kale".
  t = t.replace(/\b(?:with|using|have|got)\s+([a-z][a-z ,\-]*?)(?=\s*(?:\bunder\b|\bin\b|\bfor\b|$))/g, (all, list: string) => {
    let kept = '';
    for (const piece of list.split(/\s*(?:,|\band\b|\bor\b|&)\s*/)) {
      const { p, rest } = takeIngredient(piece.replace(/^(some|leftover|fresh|a|an|the)\s+/, ''));
      if (p != null) out.with.push(p);
      kept += ` ${rest}`;
    }
    return kept ? ` ${kept} ` : ' ';
  });

  out.q = t.replace(/\bno(bake|knead|churn|cook|boil)\b/g, 'no $1').replace(/\s+/g, ' ').trim();
  // Nothing left but filler means the words were all used up.
  if (!words(out.q).some((w) => !STOP.has(w))) out.q = '';
  return out;
}

// ---------------------------------------------------------------------------------------
// Searching

/** How well a recipe's words match the query words; 0 means it doesn't. */
function textScore(r: Recipe, q: string[], loose = false): number {
  if (!q.length) return 1;
  let score = 0;
  let missed = 0;
  for (const [n, t] of q.entries()) {
    const last = n === q.length - 1;
    const hit = (w: string) => w === t || (last && t.length > 1 && w.startsWith(t));
    if (r.title.some(hit)) score += r.title.includes(t) ? 8 : 6;
    else if (r.other.some(hit)) score += 3;
    else if (!loose) return 0;
    else missed++;
  }
  // Loose: when nothing has every word, keep what has most of them, ranked by how many.
  if (loose && (missed === q.length || missed > Math.floor(q.length / 2))) return 0;
  if (q.length > 1 && r.titleText.includes(` ${q.join(' ')}`)) score += 10;
  return score - missed * 100;
}

/** Whether an ingredient you're using covers a recipe's ingredient: pork covers pork belly. */
function covers(chosen: number[], p: number): boolean {
  return chosen.includes(p) || data.ing[p][3].some((parent) => chosen.includes(parent));
}

type Skip = 'site' | 'time' | 'cuisine';

function passesFilters(r: Recipe, skip?: Skip): boolean {
  if (skip !== 'site' && state.sites.size && !state.sites.has(r.src.id)) return false;
  if (skip !== 'time' && state.time && (r.min == null || r.min > state.time)) return false;
  if (skip !== 'cuisine' && state.cuisine && r.cuisine !== state.cuisine) return false;
  return true;
}

/** Ingredient positions to leave out: "no pork" tags and a vegetarian or vegan search. */
function excluded(): Set<number> {
  return new Set([...state.without, ...(state.diet ? data.diet?.[state.diet] || [] : [])]);
}

function search(opts: { q?: string; with?: number[]; skip?: Skip; loose?: boolean } = {}): Hit[] {
  const q = queryWords(opts.q ?? state.q).words;
  const chosen = opts.with ?? state.with;
  const out = excluded();
  const notWords = state.notWords.map((w) => words(w)[0]);
  const hits: Hit[] = [];
  for (const r of recipes) {
    if (!passesFilters(r, opts.skip)) continue;
    if (out.size && [...r.pos].some((p) => out.has(p))) continue;
    if (notWords.length && notWords.some((w) => r.title.includes(w))) continue;
    const t = textScore(r, q, opts.loose);
    if (!t) continue;
    let used: number[] = [];
    let missing = 0;
    if (chosen.length) {
      used = chosen.filter((p) => r.pos.has(p));
      if (!used.length) continue;
      missing = r.own.filter((p) => !covers(chosen, p)).length;
    }
    hits.push({ r, score: t + popBonus(r), used, missing });
  }
  hits.sort(
    (a, b) =>
      b.used.length - a.used.length ||
      (chosen.length ? a.missing - b.missing : 0) ||
      b.score - a.score ||
      Number(!!b.r.img) - Number(!!a.r.img) ||
      (q.length || chosen.length ? (a.r.min ?? 999) - (b.r.min ?? 999) : a.r.name.localeCompare(b.r.name)),
  );
  return mix(hits, chosen.length > 0);
}

/**
 * Recipes people open more rank a little higher: up to 4 points, on a log scale, so a
 * popular recipe beats an equally good match but never a clearly better one (a word in
 * the name is worth 6 to 8).
 */
const popBonus = (r: Recipe) => Math.min(4, Math.log2(1 + r.opens));

/**
 * Take turns between creators. Within each tier (same number of your ingredients used),
 * the next pick is the best recipe that's nearly as good as the best one left (within a
 * couple of points, or needing at most one more ingredient) whose creator hasn't appeared
 * in the last three picks. Close calls get mixed; a clearly better match still comes first.
 */
function mix(hits: Hit[], byIngredients: boolean): Hit[] {
  const out: Hit[] = [];
  const tierOf = (h: Hit) => (byIngredients ? String(h.used.length) : '');
  const BAND = 2;
  for (let i = 0; i < hits.length; ) {
    let j = i;
    while (j < hits.length && tierOf(hits[j]) === tierOf(hits[i])) j++;
    const pool = hits.slice(i, j);
    const recent: string[] = [];
    while (pool.length) {
      const top = pool[0];
      const close = (h: Hit) => (byIngredients ? h.missing <= top.missing + 1 : h.score >= top.score - BAND);
      let pick = 0;
      for (let k = 0; k < Math.min(pool.length, 300) && close(pool[k]); k++) {
        if (!recent.includes(pool[k].r.src.id)) {
          pick = k;
          break;
        }
      }
      const [h] = pool.splice(pick, 1);
      out.push(h);
      recent.push(h.r.src.id);
      if (recent.length > 3) recent.shift();
    }
    i = j;
  }
  return out;
}

/**
 * Videos for the search: shown when there are words, or a creator is picked. Words match
 * the title (or the channel's name); ingredients alone match ingredients named in the
 * title. Takes turns between channels, newest first within each, so one prolific
 * channel doesn't fill the list.
 */
function searchVideos(opts: { q?: string; skip?: Skip } = {}): VideoRow[] {
  const q = queryWords(opts.q ?? state.q).words;
  const leaveOut = excluded();
  const sites = opts.skip === 'site' ? new Set<string>() : state.sites;
  // Videos come along when there are words or a creator; ingredients alone bring them
  // only when you've asked for videos.
  if (!q.length && !sites.size && !(state.show === 'videos' && state.with.length)) return [];
  const chanWords = data.videos.sources.map((c) => words(c.name));
  const matched = data.videos.rows.filter((v) => {
    if (sites.size && !sites.has(creatorOfChannel(v[0]))) return false;
    if (leaveOut.size && v[4].some((p) => leaveOut.has(p))) return false;
    if (state.notWords.length && words(v[1]).some((w) => state.notWords.some((n) => words(n)[0] === w))) return false;
    if (q.length) {
      const t = [...words(v[1]), ...chanWords[v[0]]];
      return q.every((w, n) => t.some((x) => x === w || (n === q.length - 1 && x.startsWith(w))));
    }
    return !state.with.length || v[4].some((p) => state.with.includes(p));
  });
  const byChannel = new Map<number, VideoRow[]>();
  for (const v of matched) byChannel.set(v[0], [...(byChannel.get(v[0]) || []), v]);
  const queues = [...byChannel.values()].sort((a, b) => b.length - a.length);
  const out: VideoRow[] = [];
  for (let round = 0; queues.some((qq) => qq.length > round); round++) for (const qq of queues) if (qq[round]) out.push(qq[round]);
  return out;
}

const isBlank = () =>
  !state.q && !state.with.length && !state.without.length && !state.notWords.length && !state.diet && !state.sites.size && !state.time && !state.cuisine;
const filterCount = () => Number(!!state.sites.size) + Number(!!state.time) + Number(!!state.cuisine) + Number(!!state.show);

// ---------------------------------------------------------------------------------------
// Rendering

const ingName = (p: number) => data.ing[p][1].toLowerCase();

function highlight(name: string, q: string[]): string {
  if (!q.length) return esc(name);
  // Mark the start of each word that matches a query word ("tofu" in "Mapo Tofu").
  return name
    .split(/(\s+)/)
    .map((part) => {
      const w = words(part)[0];
      const t = w && q.find((t) => w === t || w.startsWith(t));
      if (!t) return esc(part);
      const n = Math.min(part.length, Math.max(t.length, part.replace(/[^\p{L}\p{N}]+$/u, '').length));
      return `<mark>${esc(part.slice(0, n))}</mark>${esc(part.slice(n))}`;
    })
    .join('');
}

/** "25 minutes, Chinese, from The Woks of Life" */
function metaLine(r: Recipe): string {
  const bits = [r.min ? fmtTime(r.min) : '', r.cuisine].filter(Boolean);
  return `${bits.length ? `${esc(bits.join(', '))}, from ` : 'From '}${esc(r.src.name)}`;
}

/** "Uses ginger and tofu, plus 3 more things" / "Uses ginger, not tofu" */
function usesLine(h: Hit): string {
  const n = state.with.length;
  if (!n) return '';
  const used = andList(h.used.map((p) => esc(ingName(p))));
  const not = state.with.filter((p) => !h.used.includes(p)).map((p) => esc(ingName(p)));
  const plus = h.missing ? `, plus ${plural(h.missing, 'more thing', 'more things')}` : '';
  return `<p class="uses">Uses ${used}${not.length && n > 1 ? ` (not ${orList(not)})` : ''}${plus}</p>`;
}

// Result names aren't highlighted: every result matches, so marking the words again is
// noise. Suggestions still highlight, since there it shows what you've typed so far.
function row(h: Hit, position: number, _q: string[], from = 'results'): string {
  const { r } = h;
  const photo = r.img
    ? `<img src="${esc(r.img)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" width="480" height="360">`
    : `<span class="no-photo">No photo</span>`;
  // The name comes first in the page so screen readers hear it first; CSS puts the photo on the left.
  return `<article class="row">
    <div class="text">
      <h3><a href="${esc(r.url)}" data-pos="${position}" data-src-id="${esc(r.src.id)}" data-key="${esc(r.key)}" data-from="${from}">${esc(r.name)}</a></h3>
      <p class="meta">${metaLine(r)}</p>${usesLine(h)}
    </div>
    <div class="photo">${photo}</div>
  </article>`;
}

function render() {
  const understood = queryWords(state.q);
  const q = understood.words;
  qInput.value = state.q;
  renderTags();
  renderFilterButtons();
  renderPicked();

  const blank = isBlank();
  page.dataset.mode = blank && state.picked < 0 ? 'home' : 'results';
  $('start').hidden = !blank;
  $('empty').hidden = true;
  $('also').hidden = true;
  $('videos').hidden = true;

  if (blank) {
    resultsEl.innerHTML = '';
    moreBtn.hidden = true;
    statusEl.innerHTML = '';
    return;
  }

  let hits = state.show === 'videos' ? [] : search();
  // Nothing has every word: show what has most of them, and say so.
  const loose = !hits.length && q.length > 1 && state.show !== 'videos';
  if (loose) hits = search({ loose: true });
  const videos = state.show === 'recipes' ? [] : searchVideos();
  const shown = hits.slice(0, state.shown);
  resultsEl.innerHTML = shown.map((h, n) => `<li>${row(h, n + 1, q)}</li>`).join('');
  moreBtn.hidden = hits.length <= state.shown;
  moreBtn.textContent = `Show ${Math.min(PAGE, hits.length - shown.length)} more of ${(hits.length - shown.length).toLocaleString()}`;

  const count = `<strong>${hits.length.toLocaleString()}</strong>`;
  const vids = videos.length ? ` and ${plural(videos.length, 'video')} on YouTube` : '';
  if (loose && hits.length) statusEl.innerHTML = `Nothing has every word, so these ${plural(hits.length, 'recipe')} have most of them.`;
  else if (state.show === 'videos' && !videos.length) statusEl.textContent = 'No videos match all of that.';
  else if (!hits.length && videos.length) statusEl.innerHTML = `<strong>${videos.length.toLocaleString()}</strong> ${videos.length === 1 ? 'video' : 'videos'} on YouTube.`;
  else if (!hits.length) statusEl.textContent = 'Nothing matches all of that.';
  else if (state.with.length > 1)
    statusEl.innerHTML = `${count} ${hits.length === 1 ? 'recipe uses' : 'recipes use'} at least one of them${vids}. The ones that use the most come first.`;
  else statusEl.innerHTML = `${count} ${hits.length === 1 ? 'recipe' : 'recipes'}${vids}.`;

  // A typo we fixed: say what we searched, and offer the words as typed.
  if (understood.fixes.length)
    statusEl.innerHTML = `Showing results for “${esc(q.join(' '))}”. <button type="button" data-exact="1">Search for “${esc(
      state.q,
    )}” instead</button>. ${statusEl.innerHTML}`;
  if (!hits.length && !videos.length && state.show !== 'videos') renderEmpty();
  // Six videos under the recipes; a page at a time when there are only videos (a
  // YouTube-only creator like Kenji).
  const only = !hits.length;
  renderVideos(videos.slice(0, only ? state.shown : 6), q, only);
  const moreV = $<HTMLButtonElement>('more-videos');
  moreV.hidden = !only || videos.length <= state.shown;
  moreV.textContent = `Show ${Math.min(PAGE, videos.length - state.shown)} more of ${(videos.length - state.shown).toLocaleString()}`;
  renderAlso();
}

/** Creator and ingredient tags, inside the box before the text. */
function renderTags() {
  const tag = (attr: string, value: string | number, label: string, kind: string) =>
    `<li><button type="button" class="tag tag-${kind}" ${attr}="${esc(value)}" aria-label="Remove ${esc(label)}">${esc(label)}<span class="x" aria-hidden="true">×</span></button></li>`;
  $('with-chips').innerHTML = [
    ...[...state.sites].map((id) => tag('data-remove-creator', id, `from ${creatorById.get(id)?.name || id}`, 'creator')),
    ...(state.diet ? [tag('data-remove-diet', state.diet, state.diet, 'diet')] : []),
    ...state.with.map((p) => tag('data-remove', p, ingName(p), 'ing')),
    ...state.without.map((p) => tag('data-remove-not', p, `no ${ingName(p)}`, 'not')),
    ...state.notWords.map((w) => tag('data-remove-word', w, `no ${w}`, 'not')),
  ].join('');
  const any = state.sites.size || state.with.length || state.without.length || state.notWords.length || state.diet;
  $('box').toggleAttribute('data-tags', !!any);
  qInput.placeholder = any ? 'and…' : 'A dish, ingredient or creator';
}

function renderEmpty() {
  const fixes: { label: string; n: number; apply: () => void }[] = [];
  for (const p of state.with) {
    if (state.with.length < 2 && !state.q) continue;
    const rest = state.with.filter((x) => x !== p);
    fixes.push({ label: `without ${ingName(p)}`, n: search({ with: rest }).length, apply: () => (state.with = rest) });
  }
  if (state.q && state.with.length)
    fixes.push({ label: `any dish, not just “${state.q}”`, n: search({ q: '' }).length, apply: () => (state.q = '') });
  if (state.without.length || state.notWords.length || state.diet)
    fixes.push({
      label: 'leaving nothing out',
      n: (() => {
        const [w, nw, d] = [state.without, state.notWords, state.diet];
        [state.without, state.notWords, state.diet] = [[], [], ''];
        const n = search().length;
        [state.without, state.notWords, state.diet] = [w, nw, d];
        return n;
      })(),
      apply: () => ([state.without, state.notWords, state.diet] = [[], [], '']),
    });
  if (state.sites.size) fixes.push({ label: 'any creator', n: search({ skip: 'site' }).length, apply: () => state.sites.clear() });
  if (state.time) fixes.push({ label: 'any time', n: search({ skip: 'time' }).length, apply: () => (state.time = 0) });
  if (state.cuisine) fixes.push({ label: 'any cuisine', n: search({ skip: 'cuisine' }).length, apply: () => (state.cuisine = '') });
  const useful = fixes.filter((f) => f.n > 0).sort((a, b) => b.n - a.n);
  emptyFixes = useful.map((f) => f.apply);
  $('empty').hidden = false;
  const tries = useful.map((f, n) => `<button type="button" data-fix="${n}">${esc(f.label)}</button> (${plural(f.n, 'recipe')})`);
  const over = `<button type="button" data-fix="clear">start over</button>`;
  $('fixes').innerHTML = tries.length
    ? `Try ${orList([...tries, over])}.`
    : state.q
      ? `Try fewer or different words, or ${over}.`
      : `Try ${over}.`;
}
let emptyFixes: (() => void)[] = [];

function renderVideos(hits: VideoRow[], q: string[], only: boolean) {
  if (!hits.length) return;
  const chans = data.videos.sources;
  $('videos').hidden = false;
  $('videos').toggleAttribute('data-only', only);
  $('video-results').innerHTML = hits
    .map(
      (v) => `<li><article class="row">
      <div class="text">
        <h3><a href="https://www.youtube.com/watch?v=${esc(v[2])}" data-src-id="youtube" data-from="videos">${esc(v[1])}</a></h3>
        <p class="meta">Video on YouTube, from ${esc(chans[v[0]].name)}</p>
      </div>
      <div class="photo"><img src="https://i.ytimg.com/vi/${esc(v[2])}/mqdefault.jpg" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" width="320" height="180"></div>
    </article></li>`,
    )
    .join('');
}

function renderAlso() {
  const term = state.q || state.with.map(ingName).join(' ');
  if (!term || !data.linkOnly.length) return;
  const links = data.linkOnly.map(
    (l) => `<a href="${esc(l.search.replace('{q}', encodeURIComponent(term)))}" data-other="${esc(l.name)}">${esc(l.name)}</a>`,
  );
  const also = $('also');
  also.hidden = false;
  also.innerHTML = `Not here? Search ${orList(links)} for “${esc(term)}”.`;
}

/** "Support them: Patreon, YouTube, or their books Hot Thai Kitchen and Sabai." */
function supportLine(id: string): string {
  const all = data.support[id] || [];
  if (!all.length) return '';
  const a = (l: { label: string; url: string; book?: boolean }) =>
    `<a href="${esc(l.url)}" data-support="${esc(id)}" data-kind="${l.book ? 'book' : 'link'}">${l.book ? `<cite>${esc(l.label)}</cite>` : esc(l.label)}</a>`;
  const links = all.filter((l) => !l.book).map(a);
  const books = all.filter((l) => l.book).map(a);
  const bookPart = books.length ? `${books.length === 1 ? 'their book' : 'their books'} ${andList(books)}` : '';
  return `<p class="support">Support them: ${orList([...links, bookPart].filter(Boolean))}.</p>`;
}

// ---------------------------------------------------------------------------------------
// Pick one at random: from what you're looking at, or from everything.

function pickRandom() {
  const pool = isBlank() ? recipes.map((r) => ({ r })) : search();
  if (!pool.length) return;
  let next = pool[Math.floor(Math.random() * pool.length)].r.i;
  if (pool.length > 1 && next === state.picked) next = pool[(pool.findIndex((h) => h.r.i === next) + 1) % pool.length].r.i;
  state.picked = next;
  render();
  const box = $('picked');
  box.focus({ preventScroll: true });
  box.scrollIntoView({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  track('Picked Random Recipe', {
    experiment: EXPERIMENT,
    source: recipes[next].src.id,
    pool_size: pool.length,
    ingredient_count: state.with.length,
  });
}

function renderPicked() {
  const box = $('picked');
  if (state.picked < 0) {
    box.hidden = true;
    return;
  }
  const r = recipes[state.picked];
  const used = state.with.filter((p) => r.pos.has(p));
  const missing = r.own.filter((p) => !covers(state.with, p)).length;
  $('picked-card').innerHTML = row({ r, score: 0, used, missing }, 0, words(state.q), 'random') + supportLine(r.src.id);
  box.hidden = false;
}

// ---------------------------------------------------------------------------------------
// Filters: words that open a menu of native radios and checkboxes.

function buildFilters() {
  $('f-site-options').innerHTML = creators
    .map(
      (c) =>
        `<label><input type="checkbox" name="site" value="${esc(c.id)}"> ${esc(c.name)} <span class="count"></span></label>`,
    )
    .join('');
  $('f-show-options').innerHTML = (
    [
      ['', 'Recipes and videos'],
      ['recipes', 'Recipes'],
      ['videos', 'Videos'],
    ] as const
  )
    .map(([v, label]) => `<label><input type="radio" name="show" value="${v}"> ${label} <span class="count"></span></label>`)
    .join('');
  $('f-time-options').innerHTML = [0, ...TIMES]
    .map(
      (t) => `<label><input type="radio" name="time" value="${t}"> ${t ? `${t} minutes or less` : 'Any time'} <span class="count"></span></label>`,
    )
    .join('');
  $('f-cuisine-options').innerHTML = [['', 0] as [string, number], ...data.cuisines]
    .map(([c]) => `<label><input type="radio" name="cuisine" value="${esc(c)}"> ${c ? esc(c) : 'Any cuisine'} <span class="count"></span></label>`)
    .join('');

  for (const pop of document.querySelectorAll<HTMLElement>('.pop')) {
    pop.addEventListener('change', (e) => {
      const el = e.target as HTMLInputElement;
      if (el.name === 'site') el.checked ? state.sites.add(el.value) : state.sites.delete(el.value);
      if (el.name === 'time') state.time = Number(el.value);
      if (el.name === 'cuisine') state.cuisine = el.value;
      if (el.name === 'show') state.show = el.value as typeof state.show;
      state.shown = PAGE;
      render();
      updateCounts(pop);
      writeUrl(false);
    });
    // Open under its word on wider screens; on phones CSS makes it a sheet at the bottom.
    pop.addEventListener('toggle', (e) => {
      if ((e as ToggleEvent).newState !== 'open') return;
      updateCounts(pop);
      if (matchMedia('(max-width: 40rem)').matches) return;
      const btn = document.querySelector<HTMLElement>(`[popovertarget="${pop.id}"]`)!;
      const r = btn.getBoundingClientRect();
      pop.style.inset = 'auto';
      pop.style.top = `${r.bottom + 6}px`;
      pop.style.left = `${Math.max(16, Math.min(r.left, innerWidth - pop.offsetWidth - 16))}px`;
    });
  }
  addEventListener(
    'scroll',
    () => {
      if (matchMedia('(max-width: 40rem)').matches) return;
      document.querySelectorAll<HTMLElement>('.pop:popover-open').forEach((p) => p.hidePopover());
    },
    { passive: true },
  );
}

/** Each option's count, given everything else you've picked, so "Thai 12" means 12 here. */
function updateCounts(pop: HTMLElement) {
  if (pop.id === 'f-show') {
    const was = state.show;
    const n = (show: typeof state.show) => {
      state.show = show;
      const r = show === 'videos' ? 0 : search().length;
      const v = show === 'recipes' ? 0 : searchVideos().length;
      return show === 'recipes' ? plural(r, 'recipe') : show === 'videos' ? plural(v, 'video') : `${plural(r, 'recipe')}, ${plural(v, 'video')}`;
    };
    for (const label of pop.querySelectorAll('label')) label.querySelector('.count')!.textContent = n(label.querySelector('input')!.value as typeof state.show);
    state.show = was;
    return;
  }
  const kind = pop.id.slice(2) as Skip;
  const hits = isBlank() ? recipes.map((r) => ({ r })) : search({ skip: kind });
  const vids = kind === 'site' ? (state.q ? searchVideos({ skip: 'site' }) : data.videos.rows) : [];
  for (const label of pop.querySelectorAll('label')) {
    const el = label.querySelector('input')!;
    let text = '';
    if (kind === 'site') {
      const n = hits.filter((h) => h.r.src.id === el.value).length;
      const v = creatorById.get(el.value)!.recipes ? 0 : vids.filter((x) => creatorOfChannel(x[0]) === el.value).length;
      text = v ? plural(v, 'video') : n.toLocaleString();
    }
    if (kind === 'time')
      text = (Number(el.value) ? hits.filter((h) => h.r.min != null && h.r.min <= Number(el.value)).length : hits.length).toLocaleString();
    if (kind === 'cuisine') text = (el.value ? hits.filter((h) => h.r.cuisine === el.value).length : hits.length).toLocaleString();
    label.querySelector('.count')!.textContent = text;
  }
}

function renderFilterButtons() {
  const site =
    state.sites.size === 1 ? creatorById.get([...state.sites][0])?.name || '' : state.sites.size ? `${state.sites.size} creators` : '';
  const set = (id: string, value: string) => {
    $(`${id}-value`).textContent = value || 'any';
    $(`${id}-btn`).toggleAttribute('data-active', !!value);
  };
  set('f-site', site);
  set('f-time', state.time ? `${fmtTime(state.time)} or less` : '');
  set('f-cuisine', state.cuisine);
  set('f-show', state.show === 'recipes' ? 'recipes only' : state.show === 'videos' ? 'videos only' : '');
  $('f-show-value').textContent = state.show ? $('f-show-value').textContent : 'recipes and videos';
  for (const el of document.querySelectorAll<HTMLInputElement>('.pop input')) {
    if (el.name === 'site') el.checked = state.sites.has(el.value);
    if (el.name === 'time') el.checked = Number(el.value) === state.time;
    if (el.name === 'cuisine') el.checked = el.value === state.cuisine;
    if (el.name === 'show') el.checked = el.value === state.show;
  }
  $('clear-all').hidden = isBlank();
}

// ---------------------------------------------------------------------------------------
// Ideas under the box on the home page

/** Keeps the comma or period after a word button on the button's line. */
const keepPunct = (html: string) => html.replace(/(<button[^>]*>[^<]*<\/button>[,.])/g, '<span class="keep">$1</span>');

function buildStart() {
  // Totals, not names: the list of creators is under the box and on the About page.
  $('from').textContent = `${plural(data.recipes.length, 'recipe')} and ${plural(data.videos.rows.length, 'video')} from ${creators.length} creators. Every one opens on its creator’s own site.`;
  const tries = TRY.filter((t) => search({ q: t, with: [] }).length)
    .slice(0, 4)
    .map((t) => `<button type="button" data-try="${esc(t)}">${esc(t)}</button>`);
  $('try').innerHTML = keepPunct(`Try ${orList(tries)}.`);
  const pop = data.popular.slice(0, POPULAR_SHOWN).map((p) => `<button type="button" data-add="${p}">${esc(ingName(p))}</button>`);
  $('popular').innerHTML = keepPunct(`Or start with what you have: ${orList(pop)}.`);
  // Two creators, not all of them: the full list (with ways to support each) is on About.
  const who = creators.slice(0, 2).map((c) => `<button type="button" data-creator="${esc(c.id)}">${esc(c.name)}</button>`);
  $('creators').innerHTML = keepPunct(
    `Or start with a creator, like ${orList(who)}. <a href="/recipe-search/about/#who">See all ${creators.length}</a>.`,
  );
}

// ---------------------------------------------------------------------------------------
// Suggestions under the box (the ARIA combobox pattern: focus stays in the field, arrows
// move the highlighted option, Enter picks it). Creators and ingredients first, as things
// to add; then recipes to open; then a plain search for the words.

type Option =
  | { kind: 'not'; p: number }
  | { kind: 'creator'; c: Creator }
  | { kind: 'ing'; p: number }
  | { kind: 'recipe'; h: Hit; n: number }
  | { kind: 'all'; n: number; text: string };

const suggest = {
  options: [] as Option[],
  active: -1,
  panel: $('q-panel'),
  list: $('q-list'),

  open() {
    const text = qInput.value.trim();
    if (!data || !text) return this.close();
    this.options = buildOptions(text);
    if (!this.options.length) return this.close();
    this.active = -1;
    this.list.innerHTML = this.options
      .map((o, n) => `<span role="option" id="q-opt-${n}" aria-selected="false" data-n="${n}" data-kind="${o.kind}">${optionLabel(o, text)}</span>`)
      .join('');
    this.panel.hidden = false;
    qInput.setAttribute('aria-expanded', 'true');
    qInput.removeAttribute('aria-activedescendant');
  },

  close() {
    this.panel.hidden = true;
    qInput.setAttribute('aria-expanded', 'false');
    qInput.removeAttribute('aria-activedescendant');
    this.options = [];
    this.active = -1;
  },

  move(by: number) {
    if (this.panel.hidden) return this.open();
    const last = this.options.length - 1;
    this.active = by > 0 ? (this.active >= last ? 0 : this.active + 1) : this.active <= 0 ? last : this.active - 1;
    for (const el of this.list.querySelectorAll('[role="option"]')) el.setAttribute('aria-selected', String(el.id === `q-opt-${this.active}`));
    qInput.setAttribute('aria-activedescendant', `q-opt-${this.active}`);
    $(`q-opt-${this.active}`).scrollIntoView({ block: 'nearest' });
  },
};

const creatorMatches = (text: string): Creator[] => {
  const q = words(text);
  if (!q.length) return [];
  return creators.filter(
    (c) => !state.sites.has(c.id) && q.every((t, n) => c.words.some((w) => w === t || (n === q.length - 1 && w.startsWith(t)))),
  );
};

const ingMatches = (text: string): number[] => {
  const qs = words(text).join(' ');
  if (!qs) return [];
  const quality = (p: number) => (ingNames[p].some((n) => n === qs) ? 3 : ingNames[p].some((n) => n.startsWith(qs)) ? 2 : 1);
  return data.ing
    .map((_, p) => p)
    .filter((p) => !state.with.includes(p) && ingRecipes[p] > 0 && ingNames[p].some((n) => n.startsWith(qs) || n.includes(` ${qs}`)))
    .sort((a, b) => quality(b) - quality(a) || ingRecipes[b] - ingRecipes[a]);
};

function buildOptions(text: string): Option[] {
  // "no pork", "without pea…": offer to leave an ingredient out.
  const not = text.match(/^(?:no|without|not)\s+(.{2,})$/i);
  if (not) {
    const ps = ingMatches(not[1]).filter((p) => !state.without.includes(p)).slice(0, 4);
    if (ps.length) return ps.map((p) => ({ kind: 'not' as const, p }));
  }
  const out: Option[] = creatorMatches(text)
    .slice(0, 2)
    .map((c) => ({ kind: 'creator' as const, c }));
  if (text.length > 1) out.push(...ingMatches(text).slice(0, 3).map((p) => ({ kind: 'ing' as const, p })));
  const hits = search({ q: text });
  out.push(...hits.slice(0, 4).map((h, n) => ({ kind: 'recipe' as const, h, n: n + 1 })));
  if (hits.length) out.push({ kind: 'all', n: hits.length, text });
  return out;
}

function optionLabel(o: Option, text: string): string {
  if (o.kind === 'not')
    return `<span class="opt-text"><span class="opt-name">No ${esc(ingName(o.p))}</span><span class="opt-meta">Leave out recipes that use it</span></span>`;
  const qs = words(text).join(' ');
  if (o.kind === 'creator') {
    const has = [o.c.recipes ? plural(o.c.recipes, 'recipe') : '', o.c.videos ? plural(o.c.videos, 'video') : ''].filter(Boolean);
    return `<span class="opt-text"><span class="opt-name">${esc(o.c.name)}</span><span class="opt-meta">Creator, ${andList(has)}</span></span>`;
  }
  if (o.kind === 'ing') {
    // When it matched another name ("thai ginger" for galangal), say so.
    const others = data.ing[o.p].slice(4) as string[];
    const main = ingNames[o.p][0];
    const via =
      main.startsWith(qs) || main.includes(` ${qs}`)
        ? ''
        : others.find((_, k) => ingNames[o.p][k + 1].startsWith(qs) || ingNames[o.p][k + 1].includes(` ${qs}`)) || '';
    return `<span class="opt-text"><span class="opt-name">${esc(ingName(o.p))}${via ? ` <span class="opt-meta">(${esc(via)})</span>` : ''}</span><span class="opt-meta">Ingredient, in ${plural(
      ingRecipes[o.p],
      'recipe',
    )}</span></span>`;
  }
  if (o.kind === 'recipe') {
    const r = o.h.r;
    const thumb = r.img
      ? `<img class="opt-thumb" src="${esc(r.img)}" alt="" loading="lazy" referrerpolicy="no-referrer" width="44" height="44">`
      : `<span class="opt-thumb" aria-hidden="true"></span>`;
    return `${thumb}<span class="opt-text"><span>${highlight(r.name, words(text))}</span><span class="opt-meta">${esc(r.src.name)}${
      r.min ? `, ${fmtTime(r.min)}` : ''
    }</span></span>`;
  }
  return `<span class="opt-text"><span class="opt-name">Search for “${esc(o.text)}”</span><span class="opt-meta">${plural(o.n, 'recipe')}</span></span>`;
}

function choose(n: number) {
  const o = suggest.options[n];
  if (!o) return;
  if (o.kind === 'not') {
    qInput.value = '';
    if (!state.without.includes(o.p)) state.without.push(o.p);
    afterTag();
    qInput.focus();
  } else if (o.kind === 'creator') {
    qInput.value = '';
    addCreator(o.c.id, 'suggestions');
    qInput.focus();
  } else if (o.kind === 'ing') {
    qInput.value = '';
    addIngredient(o.p, 'suggestions');
    qInput.focus();
  } else if (o.kind === 'recipe') {
    openedRecipe(o.h.r.src.id, o.n, 'suggestions', o.h.r.key);
    location.href = o.h.r.url;
  } else submit();
}

// ---------------------------------------------------------------------------------------
// Actions

/** Adding a tag keeps any words still in the box as words, and searches. */
function afterTag() {
  suggest.close();
  state.q = qInput.value.trim();
  state.shown = PAGE;
  state.picked = -1;
  render();
  writeUrl(true);
  searched();
}

function addIngredient(p: number, from: string) {
  if (!state.with.includes(p)) state.with.push(p);
  afterTag();
  track('Added Ingredient', { experiment: EXPERIMENT, ingredient_id: data.ing[p][0], added_from: from });
}

function addCreator(id: string, from: string) {
  state.sites.add(id);
  afterTag();
  track('Added Creator', { experiment: EXPERIMENT, creator_id: id, added_from: from });
}

function submit() {
  suggest.close();
  // Plain phrases become tags and filters ("no pork", "under 30 minutes"); the rest stays words.
  const u = understand(qInput.value);
  for (const p of u.with) if (!state.with.includes(p)) state.with.push(p);
  for (const p of u.without) if (!state.without.includes(p)) state.without.push(p);
  for (const w of u.notWords) if (!state.notWords.includes(w)) state.notWords.push(w);
  for (const id of u.sites) state.sites.add(id);
  if (u.time) state.time = u.time;
  if (u.diet) state.diet = u.diet;
  state.exact = false;
  qInput.value = u.q;
  state.q = u.q;
  state.shown = PAGE;
  state.picked = -1;
  render();
  writeUrl(true);
  searched();
  if (matchMedia('(max-width: 40rem)').matches) qInput.blur();
}

function searched() {
  if (isBlank()) return;
  track('Searched Recipes', {
    experiment: EXPERIMENT,
    search_type: state.q && state.with.length ? 'both' : state.q ? 'words' : state.with.length ? 'ingredients' : state.sites.size ? 'creator' : 'filters',
    ingredient_count: state.with.length,
    creator_count: state.sites.size,
    filter_count: filterCount(),
    result_count: search().length,
  });
}

function openedRecipe(source: string, position: number, from: string, key = '') {
  // recipe_key ("woks:/mapo-tofu/") is what the daily popularity count adds up.
  track('Opened Recipe', {
    experiment: EXPERIMENT,
    source,
    position,
    opened_from: from,
    ingredient_count: state.with.length,
    ...(key ? { recipe_key: key } : {}),
  });
}

// ---------------------------------------------------------------------------------------
// URL state

function writeUrl(push: boolean) {
  const u = new URL(location.href);
  u.search = '';
  u.hash = '';
  if (state.q) u.searchParams.set('q', state.q);
  if (state.with.length) u.searchParams.set('with', state.with.map((p) => data.ing[p][0]).join(','));
  if (state.sites.size) u.searchParams.set('site', [...state.sites].join(','));
  if (state.time) u.searchParams.set('time', String(state.time));
  if (state.cuisine) u.searchParams.set('cuisine', state.cuisine);
  if (state.show) u.searchParams.set('show', state.show);
  if (state.without.length) u.searchParams.set('without', state.without.map((p) => data.ing[p][0]).join(','));
  if (state.notWords.length) u.searchParams.set('not', state.notWords.join(','));
  if (state.diet) u.searchParams.set('diet', state.diet);
  if (state.exact) u.searchParams.set('exact', '1');
  if (u.href === location.href) return;
  history[push ? 'pushState' : 'replaceState'](null, '', u);
}

function readUrl() {
  const p = new URLSearchParams(location.search);
  state.q = (p.get('q') || '').trim();
  state.with = (p.get('with') || '')
    .split(',')
    .map((id) => ingById.get(id))
    .filter((x): x is number => x != null);
  state.sites = new Set((p.get('site') || '').split(',').filter((id) => creatorById.has(id)));
  const t = Math.round(Number(p.get('time')));
  state.time = t > 0 && t <= 600 ? t : 0;
  state.without = (p.get('without') || '')
    .split(',')
    .map((id) => ingById.get(id))
    .filter((x): x is number => x != null);
  state.notWords = (p.get('not') || '').split(',').map((w) => w.trim().toLowerCase()).filter(Boolean);
  const diet = p.get('diet');
  state.diet = diet === 'vegetarian' || diet === 'vegan' ? diet : '';
  state.exact = p.get('exact') === '1';
  const c = p.get('cuisine') || '';
  state.cuisine = data.cuisines.some(([name]) => name === c) ? c : '';
  const show = p.get('show');
  state.show = show === 'recipes' || show === 'videos' ? show : '';
  state.shown = PAGE;
  state.picked = -1;
}

// ---------------------------------------------------------------------------------------
// Events

form.addEventListener('submit', (e) => {
  e.preventDefault();
  if (suggest.active >= 0) return choose(suggest.active);
  submit();
});

qInput.addEventListener('input', () => {
  // A comma finishes an ingredient (or a creator), like a tag field: "ginger, tofu, ".
  if (qInput.value.includes(',')) {
    const text = qInput.value.replace(/,/g, ' ').trim();
    const ing = ingMatches(text)[0];
    const creator = creatorMatches(text)[0];
    if (ing != null || creator) {
      qInput.value = '';
      return ing != null ? addIngredient(ing, 'typed') : addCreator(creator.id, 'typed');
    }
    qInput.value = qInput.value.replace(/,/g, ' ');
  }
  suggest.open();
});
qInput.addEventListener('focus', () => qInput.value.trim() && suggest.open());
qInput.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    suggest.move(e.key === 'ArrowDown' ? 1 : -1);
  } else if (e.key === 'Escape' && !suggest.panel.hidden) {
    e.preventDefault();
    suggest.close();
  } else if (
    e.key === 'Backspace' &&
    !qInput.value &&
    qInput.selectionStart === 0 &&
    (state.with.length || state.without.length || state.notWords.length || state.diet || state.sites.size)
  ) {
    // Backspace in an empty box takes off the last tag, right to left.
    if (state.notWords.length) state.notWords.pop();
    else if (state.without.length) state.without.pop();
    else if (state.with.length) state.with.pop();
    else if (state.diet) state.diet = '';
    else state.sites.delete([...state.sites].at(-1)!);
    state.shown = PAGE;
    render();
    writeUrl(false);
  }
});
// Keep focus in the field when an option is clicked.
suggest.list.addEventListener('mousedown', (e) => e.preventDefault());
suggest.list.addEventListener('click', (e) => {
  const el = (e.target as HTMLElement).closest<HTMLElement>('[role="option"]');
  if (el) choose(Number(el.dataset.n));
});
qInput.addEventListener('blur', () => setTimeout(() => document.activeElement !== qInput && suggest.close(), 0));
// Clicking the box's empty space puts the cursor in the field.
$('box').addEventListener('click', (e) => {
  if (!(e.target as HTMLElement).closest('button, input')) qInput.focus();
});

app.addEventListener('click', (e) => {
  const el = (e.target as HTMLElement).closest<HTMLElement>('button, a');
  if (!el) return;
  if (el.dataset.add) addIngredient(Number(el.dataset.add), 'popular');
  else if (el.dataset.creator) addCreator(el.dataset.creator, 'home');
  else if (el.dataset.try) {
    qInput.value = el.dataset.try;
    submit();
  } else if (el.dataset.exact) {
    state.exact = true;
    render();
    writeUrl(true);
  } else if (el.dataset.remove || el.dataset.removeCreator || el.dataset.removeNot || el.dataset.removeWord || el.dataset.removeDiet) {
    if (el.dataset.remove) state.with = state.with.filter((p) => p !== Number(el.dataset.remove));
    else if (el.dataset.removeWord) state.notWords = state.notWords.filter((w) => w !== el.dataset.removeWord);
    else if (el.dataset.removeNot) state.without = state.without.filter((p) => p !== Number(el.dataset.removeNot));
    else if (el.dataset.removeDiet) state.diet = '';
    else state.sites.delete(el.dataset.removeCreator!);
    state.shown = PAGE;
    render();
    writeUrl(true);
    qInput.focus();
  } else if (el.dataset.fix) {
    if (el.dataset.fix === 'clear') clearAll();
    else emptyFixes[Number(el.dataset.fix)]?.();
    state.shown = PAGE;
    render();
    writeUrl(true);
    qInput.focus();
  } else if (el.dataset.srcId) {
    openedRecipe(el.dataset.srcId, Number(el.dataset.pos || 0), el.dataset.from || 'results', el.dataset.key);
  } else if (el.dataset.support) {
    track('Opened Support Link', { experiment: EXPERIMENT, source: el.dataset.support, link_kind: el.dataset.kind || 'link' });
  } else if (el.dataset.other) {
    track('Opened Other Search', { experiment: EXPERIMENT, site: el.dataset.other });
  }
});

function clearAll() {
  state.q = '';
  state.with = [];
  state.sites.clear();
  state.time = 0;
  state.cuisine = '';
  state.show = '';
  state.without = [];
  state.notWords = [];
  state.diet = '';
  state.exact = false;
  state.picked = -1;
  qInput.value = '';
}

for (const id of ['clear-all', 'home-link']) {
  $(id).addEventListener('click', (e) => {
    if (!data) return;
    e.preventDefault();
    clearAll();
    state.shown = PAGE;
    render();
    writeUrl(true);
    qInput.focus();
  });
}

for (const id of ['lucky', 'lucky-results', 'lucky-again']) $(id).addEventListener('click', () => data && pickRandom());

for (const [btn, list] of [[moreBtn, resultsEl], [$('more-videos'), $('video-results')]] as const) {
  btn.addEventListener('click', () => {
    const first = state.shown;
    state.shown += PAGE;
    render();
    // Move focus to the first new result, so keyboard and screen reader users keep their place.
    list.querySelectorAll<HTMLAnchorElement>('h3 a')[first]?.focus();
  });
}

// A photo that won't load (moved, blocked) gives way to a plain "No photo".
app.addEventListener(
  'error',
  (e) => {
    const img = e.target as HTMLImageElement;
    if (img.tagName !== 'IMG') return;
    if (img.classList.contains('opt-thumb')) return void (img.style.visibility = 'hidden');
    img.replaceWith(Object.assign(document.createElement('span'), { className: 'no-photo', textContent: 'No photo' }));
  },
  true,
);

addEventListener('popstate', () => {
  if (!data) return;
  readUrl();
  render();
});

load();
