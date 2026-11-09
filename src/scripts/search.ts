// Recipe search, in the browser. Loads the index once (about 150 KB over the wire), then
// every keystroke searches it locally: no server, no search service, nothing typed ever
// leaves the page. The query is a sentence: "I have <ingredients>" (#have, chips) and
// "I want to make <dish>" (#q). State lives in the URL (?q=, &with=, &site=, &time=,
// &cuisine=), so searches can be shared and the back button works.
import { track } from 'kp-design/analytics';

type Source = { id: string; name: string; site: string; host: string; count: number };
// [catalog id, name, recipes naming it, parent positions, ...other names]
type Ing = [string, string, number, number[], ...string[]];
// [source, name, url (path on the site), minutes, cuisine, ingredient positions (with parents), own positions, photo, keywords]
type RecipeRow = [number, string, string, number | null, string, number[], number[], string, string];
type VideoRow = [string, string, string, string, number[]];
type Index = {
  built: string;
  crawled: string;
  sources: Source[];
  paused: { id: string; name: string; site: string; why: string }[];
  videos: { sources: { id: string; name: string; channel: string }[]; rows: VideoRow[] };
  /** Ways to support each creator, by source id (data/support.json). */
  support: Record<string, { label: string; url: string; book?: boolean }[]>;
  linkOnly: { name: string; search: string }[];
  cuisines: [string, number][];
  popular: number[];
  ing: Ing[];
  recipes: RecipeRow[];
};

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
  title: string[];
  titleText: string;
  other: string[];
};

type Hit = { r: Recipe; score: number; used: number[]; missing: number };

const EXPERIMENT = 'recipe-search';
const PAGE = 24;
const TIMES = [15, 30, 45, 60];
const TRY = ['mapo tofu', 'pad thai', 'dumplings', 'noodle soup', 'fried rice', 'green curry', 'chocolate cake', 'scones'];

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const app = $('app');
const form = $<HTMLFormElement>('search-form');
const haveInput = $<HTMLInputElement>('have');
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
let ingNames: string[][] = []; // per position: its names, as words joined by spaces
let ingRecipes: number[] = []; // per position: how many recipes use it (directly or as a kind of it)
const ingById = new Map<string, number>();

const state = {
  q: '',
  with: [] as number[],
  sites: new Set<string>(),
  time: 0,
  cuisine: '',
  shown: PAGE,
  picked: -1, // a recipe picked at random, by index into recipes
};


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
  ingNames = data.ing.map((g) => [g[1], ...(g.slice(4) as string[])].map((n) => words(n).join(' ')));
  data.ing.forEach((g, p) => ingById.set(g[0], p));
  ingRecipes = data.ing.map(() => 0);
  recipes = data.recipes.map((row, i) => {
    const [s, name, url, min, cuisine, pos, own, img, kw] = row;
    const src = data.sources[s];
    for (const p of pos) ingRecipes[p]++;
    const title = words(name);
    const other = [...words(kw), ...words(cuisine), ...pos.flatMap((p) => ingNames[p].join(' ').split(' '))];
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
      title,
      titleText: ` ${title.join(' ')} `,
      other: [...new Set(other)],
    };
  });
  buildFilters();
  buildStart();
  buildAbout();
  readUrl();
  app.dataset.state = 'ready';
  render();
}

// ---------------------------------------------------------------------------------------
// Searching

/** How well a recipe's words match the query words; 0 means it doesn't. */
function textScore(r: Recipe, q: string[]): number {
  if (!q.length) return 1;
  let score = 0;
  for (const [n, t] of q.entries()) {
    const last = n === q.length - 1;
    const hit = (w: string) => w === t || (last && t.length > 1 && w.startsWith(t));
    if (r.title.some(hit)) score += r.title.includes(t) ? 8 : 6;
    else if (r.other.some(hit)) score += 3;
    else return 0;
  }
  if (q.length > 1 && r.titleText.includes(` ${q.join(' ')}`)) score += 10;
  return score;
}

/** Whether an ingredient you're using covers a recipe's ingredient: pork covers pork belly. */
function covers(chosen: number[], p: number): boolean {
  return chosen.includes(p) || data.ing[p][3].some((parent) => chosen.includes(parent));
}

function passesFilters(r: Recipe, skip?: 'site' | 'time' | 'cuisine'): boolean {
  if (skip !== 'site' && state.sites.size && !state.sites.has(r.src.id)) return false;
  if (skip !== 'time' && state.time && (r.min == null || r.min > state.time)) return false;
  if (skip !== 'cuisine' && state.cuisine && r.cuisine !== state.cuisine) return false;
  return true;
}

function search(opts: { q?: string; with?: number[]; skip?: 'site' | 'time' | 'cuisine' } = {}): Hit[] {
  const q = words(opts.q ?? state.q);
  const chosen = opts.with ?? state.with;
  const hits: Hit[] = [];
  for (const r of recipes) {
    if (!passesFilters(r, opts.skip)) continue;
    const t = textScore(r, q);
    if (!t) continue;
    let used: number[] = [];
    let missing = 0;
    if (chosen.length) {
      used = chosen.filter((p) => r.pos.has(p));
      if (!used.length) continue;
      missing = r.own.filter((p) => !covers(chosen, p)).length;
    }
    hits.push({ r, score: t, used, missing });
  }
  hits.sort(
    (a, b) =>
      b.used.length - a.used.length ||
      (chosen.length ? a.missing - b.missing : 0) ||
      b.score - a.score ||
      Number(!!b.r.img) - Number(!!a.r.img) ||
      (q.length || chosen.length ? (a.r.min ?? 999) - (b.r.min ?? 999) : a.r.name.localeCompare(b.r.name)),
  );
  return hits;
}

const isBlank = () => !state.q && !state.with.length && !state.sites.size && !state.time && !state.cuisine;
const filterCount = () => Number(!!state.sites.size) + Number(!!state.time) + Number(!!state.cuisine);

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

function row(h: Hit, position: number, q: string[], from = 'results'): string {
  const { r } = h;
  const photo = r.img
    ? `<img src="${esc(r.img)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" width="480" height="360">`
    : `<span class="no-photo">No photo</span>`;
  // The name comes first in the page so screen readers hear it first; CSS puts the photo on the left.
  return `<article class="row">
    <div class="text">
      <h3><a href="${esc(r.url)}" data-pos="${position}" data-src-id="${esc(r.src.id)}" data-from="${from}">${highlight(r.name, q)}</a></h3>
      <p class="meta">${metaLine(r)}</p>${usesLine(h)}
    </div>
    <div class="photo">${photo}</div>
  </article>`;
}

function render() {
  const q = words(state.q);
  qInput.value = state.q;
  renderWith();
  renderFilterButtons();
  renderPicked();

  const blank = isBlank();
  $('start').hidden = !blank;
  $('empty').hidden = true;
  $('also').hidden = true;
  $('videos').hidden = true;

  if (blank) {
    resultsEl.innerHTML = '';
    moreBtn.hidden = true;
    statusEl.innerHTML = `<strong>${data.recipes.length.toLocaleString()}</strong> recipes to choose from.`;
    return;
  }

  const hits = search();
  const shown = hits.slice(0, state.shown);
  resultsEl.innerHTML = shown.map((h, n) => `<li>${row(h, n + 1, q)}</li>`).join('');
  moreBtn.hidden = hits.length <= state.shown;
  moreBtn.textContent = `Show ${Math.min(PAGE, hits.length - shown.length)} more of ${(hits.length - shown.length).toLocaleString()}`;

  const count = `<strong>${hits.length.toLocaleString()}</strong>`;
  if (!hits.length) statusEl.textContent = 'Nothing matches all of that.';
  else if (state.with.length > 1)
    statusEl.innerHTML = `${count} ${hits.length === 1 ? 'recipe uses' : 'recipes use'} at least one of them. The ones that use the most come first.`;
  else statusEl.innerHTML = `${count} ${hits.length === 1 ? 'recipe' : 'recipes'}.`;

  if (!hits.length) renderEmpty();
  renderVideos(q);
  renderAlso();
}

function renderWith() {
  $('with-chips').innerHTML = state.with
    .map(
      (p, n) =>
        `<li><button type="button" data-remove="${p}" aria-label="Remove ${esc(ingName(p))}">${esc(ingName(p))}<span class="x" aria-hidden="true">×</span></button>${
          n < state.with.length - 1 ? '' : ''
        }</li>`,
    )
    .join('');
  haveInput.placeholder = state.with.length ? 'and…' : 'an ingredient';
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
  if (state.sites.size) fixes.push({ label: 'any site', n: search({ skip: 'site' }).length, apply: () => state.sites.clear() });
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

function renderVideos(q: string[]) {
  const rows = data.videos.rows;
  if (!rows.length || !q.length || state.sites.size) return;
  const hits = rows
    .filter((v) => {
      const t = words(v[1]);
      return q.every((w, n) => t.some((x) => x === w || (n === q.length - 1 && x.startsWith(w))));
    })
    .slice(0, 4);
  if (!hits.length) return;
  $('videos').hidden = false;
  $('video-results').innerHTML = hits
    .map(
      (v) => `<li><article class="row">
      <div class="text">
        <h3><a href="https://www.youtube.com/watch?v=${esc(v[2])}" data-src-id="youtube" data-from="videos">${highlight(v[1], q)}</a></h3>
        <p class="meta">Video on YouTube, from ${esc(v[0])}</p>
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
  renderPicked();
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
  $('f-site-options').innerHTML = data.sources
    .map(
      (s) =>
        `<label><input type="checkbox" name="site" value="${esc(s.id)}"> ${esc(s.name)} <span class="count">${s.count.toLocaleString()}</span></label>`,
    )
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
  const kind = pop.id.slice(2) as 'site' | 'time' | 'cuisine';
  const hits = isBlank() ? recipes.map((r) => ({ r })) : search({ skip: kind });
  for (const label of pop.querySelectorAll('label')) {
    const el = label.querySelector('input')!;
    let n = 0;
    if (kind === 'site') n = hits.filter((h) => h.r.src.id === el.value).length;
    if (kind === 'time') n = Number(el.value) ? hits.filter((h) => h.r.min != null && h.r.min <= Number(el.value)).length : hits.length;
    if (kind === 'cuisine') n = el.value ? hits.filter((h) => h.r.cuisine === el.value).length : hits.length;
    label.querySelector('.count')!.textContent = n.toLocaleString();
  }
}

function renderFilterButtons() {
  const site =
    state.sites.size === 1 ? data.sources.find((s) => state.sites.has(s.id))!.name : state.sites.size ? `${state.sites.size} sites` : '';
  const set = (id: string, value: string) => {
    $(`${id}-value`).textContent = value || 'any';
    $(`${id}-btn`).toggleAttribute('data-active', !!value);
  };
  set('f-site', site);
  set('f-time', state.time ? `${state.time} minutes or less` : '');
  set('f-cuisine', state.cuisine);
  for (const el of document.querySelectorAll<HTMLInputElement>('.pop input')) {
    if (el.name === 'site') el.checked = state.sites.has(el.value);
    if (el.name === 'time') el.checked = Number(el.value) === state.time;
    if (el.name === 'cuisine') el.checked = el.value === state.cuisine;
  }
  $('clear-all').hidden = !(filterCount() || state.with.length || state.q);
}

// ---------------------------------------------------------------------------------------
// Ideas for an empty page, and where the recipes come from

function buildStart() {
  const pop = data.popular.map((p) => `<button type="button" data-add="${p}">${esc(ingName(p))}</button>`);
  $('popular').innerHTML = `Have any of these? ${andList(pop).replace(/ and (?=<button[^>]*>[^<]*<\/button>$)/, ' or ')}.`;
  const tries = TRY.filter((t) => search({ q: t, with: [] }).length).map(
    (t) => `<button type="button" data-try="${esc(t)}">${esc(t)}</button>`,
  );
  $('try').innerHTML = `Or look up ${orList(tries)}.`;
}

function buildAbout() {
  const names = data.sources.map((s) => s.name);
  $('from').textContent = `Searches ${andList(names)}. Every recipe opens on its own site.`;
  const items = [
    ...data.sources.map((s) => `<li><a href="${esc(s.site)}">${esc(s.name)}</a>, ${plural(s.count, 'recipe')}${supportLine(s.id)}</li>`),
    ...data.paused.map(
      (s) => `<li><a href="${esc(s.site)}">${esc(s.name)}</a>, coming back once its site lets the weekly program in${supportLine(s.id)}</li>`,
    ),
    ...data.videos.sources.map(
      (v) =>
        `<li><a href="${esc(v.channel)}">${esc(v.name)}</a>, ${
          data.videos.rows.length ? plural(data.videos.rows.length, 'video') : 'videos on YouTube, coming soon'
        }${supportLine(v.id)}</li>`,
    ),
    ...data.linkOnly
      .filter((l) => !/youtube/.test(l.search))
      .map((l) => `<li>${esc(l.name)}, as a link to its own search, since its owner doesn’t allow automated collection</li>`),
  ];
  $('sources-list').innerHTML = items.join('');
  if (data.crawled) {
    const d = new Date(data.crawled + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    $('crawled').textContent = `Last updated ${d}.`;
  }
}

// ---------------------------------------------------------------------------------------
// Suggestions under each word (the ARIA combobox pattern: focus stays in the field,
// arrows move the highlighted option, Enter picks it)

type Option = { kind: 'ing'; p: number } | { kind: 'recipe'; h: Hit; n: number } | { kind: 'all'; n: number };

class Suggest {
  options: Option[] = [];
  active = -1;
  constructor(
    public input: HTMLInputElement,
    public panel: HTMLElement,
    public list: HTMLElement,
    public build: (text: string) => Option[],
    public label: (o: Option, qs: string) => string,
  ) {}

  open() {
    const text = this.input.value.trim();
    if (!data || !text) return this.close();
    this.options = this.build(text);
    if (!this.options.length) return this.close();
    this.active = -1;
    const qs = words(text).join(' ');
    this.list.innerHTML = this.options
      .map((o, n) => `<span role="option" id="${this.input.id}-opt-${n}" aria-selected="false" data-n="${n}">${this.label(o, qs)}</span>`)
      .join('');
    this.panel.hidden = false;
    this.input.setAttribute('aria-expanded', 'true');
    this.input.removeAttribute('aria-activedescendant');
  }

  close() {
    this.panel.hidden = true;
    this.input.setAttribute('aria-expanded', 'false');
    this.input.removeAttribute('aria-activedescendant');
    this.options = [];
    this.active = -1;
  }

  move(by: number) {
    if (this.panel.hidden) return this.open();
    const last = this.options.length - 1;
    this.active = by > 0 ? (this.active >= last ? 0 : this.active + 1) : this.active <= 0 ? last : this.active - 1;
    for (const el of this.list.querySelectorAll('[role="option"]'))
      el.setAttribute('aria-selected', String(el.id === `${this.input.id}-opt-${this.active}`));
    this.input.setAttribute('aria-activedescendant', `${this.input.id}-opt-${this.active}`);
    $(`${this.input.id}-opt-${this.active}`).scrollIntoView({ block: 'nearest' });
  }
}

const ingMatches = (text: string): number[] => {
  const qs = words(text).join(' ');
  const quality = (p: number) => (ingNames[p].some((n) => n === qs) ? 3 : ingNames[p].some((n) => n.startsWith(qs)) ? 2 : 1);
  return data.ing
    .map((_, p) => p)
    .filter((p) => !state.with.includes(p) && ingRecipes[p] > 0 && ingNames[p].some((n) => n.startsWith(qs) || n.includes(` ${qs}`)))
    .sort((a, b) => quality(b) - quality(a) || ingRecipes[b] - ingRecipes[a]);
};

const haveSuggest = new Suggest(
  haveInput,
  $('have-panel'),
  $('have-list'),
  (text) => ingMatches(text).slice(0, 6).map((p) => ({ kind: 'ing' as const, p })),
  (o, qs) => {
    if (o.kind !== 'ing') return '';
    // When it matched another name ("thai ginger" for galangal), say so.
    const others = data.ing[o.p].slice(4) as string[];
    const main = ingNames[o.p][0];
    const via = main.startsWith(qs) || main.includes(` ${qs}`)
      ? ''
      : others.find((_, k) => ingNames[o.p][k + 1].startsWith(qs) || ingNames[o.p][k + 1].includes(` ${qs}`)) || '';
    return `<span class="opt-text"><span class="opt-name">${esc(ingName(o.p))}${via ? ` <span class="opt-meta">(${esc(via)})</span>` : ''}</span><span class="opt-meta">in ${plural(
      ingRecipes[o.p],
      'recipe',
    )}</span></span>`;
  },
);

const qSuggest = new Suggest(
  qInput,
  $('q-panel'),
  $('q-list'),
  (text) => {
    const hits = search({ q: text });
    return [...hits.slice(0, 5).map((h, n) => ({ kind: 'recipe' as const, h, n: n + 1 })), ...(hits.length ? [{ kind: 'all' as const, n: hits.length }] : [])];
  },
  (o) => {
    if (o.kind === 'recipe') {
      const r = o.h.r;
      const thumb = r.img
        ? `<img class="opt-thumb" src="${esc(r.img)}" alt="" loading="lazy" referrerpolicy="no-referrer" width="44" height="44">`
        : `<span class="opt-thumb" aria-hidden="true"></span>`;
      return `${thumb}<span class="opt-text"><span>${highlight(r.name, words(qInput.value))}</span><span class="opt-meta">${esc(r.src.name)}${
        r.min ? `, ${fmtTime(r.min)}` : ''
      }</span></span>`;
    }
    if (o.kind === 'all') return `<span class="opt-text"><span class="opt-name">See all ${plural(o.n, 'recipe')}</span></span>`;
    return '';
  },
);

function choose(s: Suggest, n: number) {
  const o = s.options[n];
  if (!o) return;
  if (o.kind === 'ing') {
    haveInput.value = '';
    addIngredient(o.p, 'suggestions');
    haveInput.focus();
  } else if (o.kind === 'recipe') {
    openedRecipe(o.h.r.src.id, o.n, 'suggestions');
    location.href = o.h.r.url;
  } else submit();
}

// ---------------------------------------------------------------------------------------
// Actions

function addIngredient(p: number, from: string) {
  haveSuggest.close();
  if (!state.with.includes(p)) state.with.push(p);
  state.shown = PAGE;
  state.picked = -1;
  render();
  writeUrl(true);
  track('Added Ingredient', { experiment: EXPERIMENT, ingredient_id: data.ing[p][0], added_from: from });
  searched();
}

function submit() {
  haveSuggest.close();
  qSuggest.close();
  // Text left in "I have" counts too: take its best ingredient match.
  const leftover = haveInput.value.trim();
  if (leftover) {
    const best = ingMatches(leftover)[0];
    if (best != null && !state.with.includes(best)) state.with.push(best);
    haveInput.value = '';
  }
  state.q = qInput.value.trim();
  state.shown = PAGE;
  state.picked = -1;
  render();
  writeUrl(true);
  searched();
  if (matchMedia('(max-width: 40rem)').matches) (document.activeElement as HTMLElement | null)?.blur();
}

function searched() {
  if (!state.q && !state.with.length) return;
  track('Searched Recipes', {
    experiment: EXPERIMENT,
    search_type: state.q && state.with.length ? 'both' : state.q ? 'words' : 'ingredients',
    ingredient_count: state.with.length,
    filter_count: filterCount(),
    result_count: search().length,
  });
}

function openedRecipe(source: string, position: number, from: string) {
  track('Opened Recipe', { experiment: EXPERIMENT, source, position, opened_from: from, ingredient_count: state.with.length });
}

// ---------------------------------------------------------------------------------------
// URL state

function writeUrl(push: boolean) {
  const u = new URL(location.href);
  u.search = '';
  if (state.q) u.searchParams.set('q', state.q);
  if (state.with.length) u.searchParams.set('with', state.with.map((p) => data.ing[p][0]).join(','));
  if (state.sites.size) u.searchParams.set('site', [...state.sites].join(','));
  if (state.time) u.searchParams.set('time', String(state.time));
  if (state.cuisine) u.searchParams.set('cuisine', state.cuisine);
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
  state.sites = new Set((p.get('site') || '').split(',').filter((id) => data.sources.some((s) => s.id === id)));
  const t = Number(p.get('time'));
  state.time = TIMES.includes(t) ? t : 0;
  const c = p.get('cuisine') || '';
  state.cuisine = data.cuisines.some(([name]) => name === c) ? c : '';
  state.shown = PAGE;
}


// ---------------------------------------------------------------------------------------
// Events

form.addEventListener('submit', (e) => {
  e.preventDefault();
  if (haveSuggest.active >= 0 && document.activeElement === haveInput) return choose(haveSuggest, haveSuggest.active);
  if (qSuggest.active >= 0 && document.activeElement === qInput) return choose(qSuggest, qSuggest.active);
  // Enter in "I have" adds the best match, so you can type "ginger, Enter, tofu, Enter".
  if (document.activeElement === haveInput && haveInput.value.trim()) {
    const best = ingMatches(haveInput.value)[0];
    if (best != null) {
      haveInput.value = '';
      return addIngredient(best, 'typed');
    }
  }
  submit();
});

for (const s of [haveSuggest, qSuggest]) {
  s.input.addEventListener('input', () => {
    // A comma in "I have" finishes the ingredient.
    if (s === haveSuggest && s.input.value.includes(',')) {
      const best = ingMatches(s.input.value.replace(/,/g, ''))[0];
      s.input.value = '';
      if (best != null) return addIngredient(best, 'typed');
    }
    s.open();
  });
  s.input.addEventListener('focus', () => s.input.value.trim() && s.open());
  s.input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      s.move(e.key === 'ArrowDown' ? 1 : -1);
    } else if (e.key === 'Escape' && !s.panel.hidden) {
      e.preventDefault();
      s.close();
    } else if (s === haveSuggest && e.key === 'Backspace' && !s.input.value && state.with.length) {
      // Backspace in an empty "I have" takes off the last ingredient, like a tag field.
      state.with.pop();
      render();
      writeUrl(false);
    }
  });
  // Keep focus in the field when an option is clicked.
  s.list.addEventListener('mousedown', (e) => e.preventDefault());
  s.list.addEventListener('click', (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[role="option"]');
    if (el) choose(s, Number(el.dataset.n));
  });
  s.input.addEventListener('blur', () => setTimeout(() => document.activeElement !== s.input && s.close(), 0));
}

app.addEventListener('click', (e) => {
  const el = (e.target as HTMLElement).closest<HTMLElement>('button, a');
  if (!el) return;
  if (el.dataset.add) addIngredient(Number(el.dataset.add), 'popular');
  else if (el.dataset.try) {
    qInput.value = el.dataset.try;
    submit();
  } else if (el.dataset.remove) {
    state.with = state.with.filter((p) => p !== Number(el.dataset.remove));
    state.shown = PAGE;
    render();
    writeUrl(true);
    haveInput.focus();
  } else if (el.dataset.fix) {
    if (el.dataset.fix === 'clear') clearAll();
    else emptyFixes[Number(el.dataset.fix)]?.();
    state.shown = PAGE;
    render();
    writeUrl(true);
    haveInput.focus();
  } else if (el.dataset.srcId) {
    openedRecipe(el.dataset.srcId, Number(el.dataset.pos || 0), el.dataset.from || 'results');
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
  state.picked = -1;
  haveInput.value = '';
}

$('clear-all').addEventListener('click', () => {
  clearAll();
  state.shown = PAGE;
  render();
  writeUrl(true);
  haveInput.focus();
});

$('lucky').addEventListener('click', () => data && pickRandom());
$('lucky-again').addEventListener('click', () => data && pickRandom());

moreBtn.addEventListener('click', () => {
  const first = state.shown;
  state.shown += PAGE;
  render();
  // Move focus to the first new result, so keyboard and screen reader users keep their place.
  resultsEl.querySelectorAll<HTMLAnchorElement>('h3 a')[first]?.focus();
});

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
