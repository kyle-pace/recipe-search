// Recipe search, in the browser. Loads the index once (about 150 KB over the wire),
// then every keystroke searches it locally: no server, no search service, nothing typed
// ever leaves the page. State lives in the URL (?q=, &with=, &site=, &time=, &cuisine=),
// so searches can be shared and the back button works.
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
  paused: { name: string; site: string; why: string }[];
  videos: { sources: { name: string; channel: string }[]; rows: VideoRow[] };
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
const input = $<HTMLInputElement>('q');
const panel = $('suggestions-panel');
const listbox = $('suggestions');
const statusEl = $('status');
const resultsEl = $<HTMLOListElement>('results');
const moreBtn = $<HTMLButtonElement>('more');

const esc = (s: unknown) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const plural = (n: number, one: string, many = one + 's') => `${n.toLocaleString()} ${n === 1 ? one : many}`;
const fmtTime = (m: number) => (m < 60 ? `${m} min` : `${Math.floor(m / 60)} hr${m % 60 ? ` ${m % 60} min` : ''}`);

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

function card(h: Hit, position: number, q: string[]): string {
  const { r } = h;
  const meta = [r.src.name, r.cuisine].filter(Boolean).map(esc).join(' · ');
  const photo = r.img
    ? `<img src="${esc(r.img)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" width="480" height="360">`
    : `<span class="no-photo">${esc(r.src.name)}</span>`;
  const n = state.with.length;
  const names = h.used.map((p) => esc(data.ing[p][1].toLowerCase())).join(', ');
  const needs = h.missing ? `. Also needs ${plural(h.missing, 'more thing', 'more things')}` : '';
  const uses = !n
    ? ''
    : n === 1
      ? `<p class="uses">Uses <strong>${names}</strong>${needs}</p>`
      : `<p class="uses">Uses <strong>${h.used.length === n ? `all ${n}` : `${h.used.length} of your ${n}`}</strong>: ${names}${needs}</p>`;
  // The title comes first in the page so screen readers hear it first; CSS puts the photo on top.
  return `<li><article class="card" data-src="${esc(r.src.id)}">
    <h3><a href="${esc(r.url)}" data-pos="${position}" data-src-id="${esc(r.src.id)}">${highlight(r.name, q)}</a></h3>
    <div class="photo" style="order:-1">${photo}${r.min ? `<span class="time">${fmtTime(r.min)}</span>` : ''}</div>
    <p class="src"><span class="src-mark" aria-hidden="true"></span>${meta}</p>
    ${uses}
  </article></li>`;
}

function render() {
  const q = words(state.q);
  input.value = state.q;
  renderWith();
  renderFilterButtons();

  const blank = isBlank();
  $('start').hidden = !blank;
  $('empty').hidden = true;
  $('also').hidden = true;
  $('videos').hidden = true;

  if (blank) {
    resultsEl.innerHTML = '';
    moreBtn.hidden = true;
    statusEl.innerHTML = `<strong>${data.recipes.length.toLocaleString()} recipes</strong> from ${plural(data.sources.length, 'site')}. Search by dish, or start with an ingredient.`;
    return;
  }

  const hits = search();
  const shown = hits.slice(0, state.shown);
  resultsEl.innerHTML = shown.map((h, n) => card(h, n + 1, q)).join('');
  moreBtn.hidden = hits.length <= state.shown;
  moreBtn.textContent = `Show more (${(hits.length - shown.length).toLocaleString()} left)`;

  const about = [state.q && `for “${state.q}”`, state.with.length && `using ${listNames(state.with)}`].filter(Boolean).join(' ');
  statusEl.innerHTML = hits.length
    ? `<strong>${plural(hits.length, 'recipe')}</strong>${about ? ` ${esc(about)}` : ''}${state.with.length > 1 ? ', most of your ingredients first' : ''}.`
    : `No recipes${about ? ` ${esc(about)}` : ''}${filterCount() ? ' with these filters' : ''}.`;

  if (!hits.length) renderEmpty();
  renderVideos(q);
  renderAlso();
}

function listNames(ps: number[]): string {
  const names = ps.map((p) => data.ing[p][1].toLowerCase());
  return names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

function renderWith() {
  const box = $('with');
  box.hidden = !state.with.length;
  $('with-chips').innerHTML = state.with
    .map(
      (p) =>
        `<li><button type="button" data-remove="${p}" aria-label="Remove ${esc(data.ing[p][1].toLowerCase())}">${esc(
          data.ing[p][1].toLowerCase(),
        )} <span class="x" aria-hidden="true">×</span></button></li>`,
    )
    .join('');
}

function renderEmpty() {
  const fixes: { label: string; n: number; apply: () => void }[] = [];
  for (const p of state.with) {
    if (state.with.length < 2 && !state.q) continue;
    const rest = state.with.filter((x) => x !== p);
    fixes.push({ label: `Remove ${data.ing[p][1].toLowerCase()}`, n: search({ with: rest }).length, apply: () => (state.with = rest) });
  }
  if (state.q && state.with.length)
    fixes.push({ label: `Drop “${state.q}”`, n: search({ q: '' }).length, apply: () => (state.q = '') });
  if (state.sites.size)
    fixes.push({ label: 'Any site', n: search({ skip: 'site' }).length, apply: () => state.sites.clear() });
  if (state.time)
    fixes.push({ label: 'Any time', n: search({ skip: 'time' }).length, apply: () => (state.time = 0) });
  if (state.cuisine)
    fixes.push({ label: 'Any cuisine', n: search({ skip: 'cuisine' }).length, apply: () => (state.cuisine = '') });
  const useful = fixes.filter((f) => f.n > 0).sort((a, b) => b.n - a.n);
  emptyFixes = useful.map((f) => f.apply);
  $('empty').hidden = false;
  $('empty-hint').textContent = useful.length ? 'One change gets you somewhere:' : 'Try fewer or different words.';
  $('fixes').innerHTML =
    useful.map((f, n) => `<li><button type="button" data-fix="${n}">${esc(f.label)} (${f.n.toLocaleString()})</button></li>`).join('') +
    (filterCount() || state.with.length ? `<li><button type="button" data-fix="clear">Start over</button></li>` : '');
}
let emptyFixes: (() => void)[] = [];

function renderVideos(q: string[]) {
  const rows = data.videos.rows;
  if (!rows.length || !q.length || state.sites.size) return;
  const hits = rows
    .map((v) => {
      const t = words(v[1]);
      const ok = q.every((w, n) => t.some((x) => x === w || (n === q.length - 1 && x.startsWith(w))));
      return ok ? v : null;
    })
    .filter((v): v is VideoRow => !!v)
    .slice(0, 4);
  if (!hits.length) return;
  $('videos').hidden = false;
  $('video-results').innerHTML = hits
    .map(
      (v) => `<li><article class="card" data-src="youtube">
      <h3><a href="https://www.youtube.com/watch?v=${esc(v[2])}" data-src-id="youtube">${highlight(v[1], q)}</a></h3>
      <div class="photo" style="order:-1"><img src="https://i.ytimg.com/vi/${esc(v[2])}/mqdefault.jpg" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" width="320" height="180"><span class="badge-yt">YouTube</span></div>
      <p class="src"><span class="src-mark" aria-hidden="true"></span>${esc(v[0])} on YouTube</p>
    </article></li>`,
    )
    .join('');
}

function renderAlso() {
  const term = state.q || listNames(state.with).replace(/ and /g, ' ');
  if (!term || !data.linkOnly.length) return;
  const links = data.linkOnly.map(
    (l) => `<a href="${esc(l.search.replace('{q}', encodeURIComponent(term)))}" data-other="${esc(l.name)}">${esc(l.name)}</a>`,
  );
  const list = links.length < 2 ? links[0] : `${links.slice(0, -1).join(', ')} or ${links.at(-1)}`;
  const also = $('also');
  also.hidden = false;
  also.innerHTML = `Not here? Search ${list} for “${esc(term)}”.`;
}

// ---------------------------------------------------------------------------------------
// Filters (popovers with native checkboxes and radios)

function buildFilters() {
  $('f-site-options').innerHTML = data.sources
    .map(
      (s) =>
        `<label data-src="${esc(s.id)}"><input type="checkbox" name="site" value="${esc(s.id)}"> ${esc(s.name)} <span class="count">${s.count.toLocaleString()}</span></label>`,
    )
    .join('');
  $('f-time-options').innerHTML = [0, ...TIMES]
    .map(
      (t) =>
        `<label><input type="radio" name="time" value="${t}"> ${t ? `${t} minutes or less` : 'Any time'} <span class="count">${
          t ? recipes.filter((r) => r.min != null && r.min <= t).length.toLocaleString() : ''
        }</span></label>`,
    )
    .join('');
  $('f-cuisine-options').innerHTML = [['', 0] as [string, number], ...data.cuisines]
    .map(
      ([c, n]) =>
        `<label><input type="radio" name="cuisine" value="${esc(c)}"> ${c ? esc(c) : 'Any cuisine'} <span class="count">${n ? n.toLocaleString() : ''}</span></label>`,
    )
    .join('');

  for (const pop of document.querySelectorAll<HTMLElement>('.pop')) {
    pop.addEventListener('change', (e) => {
      const el = e.target as HTMLInputElement;
      if (el.name === 'site') el.checked ? state.sites.add(el.value) : state.sites.delete(el.value);
      if (el.name === 'time') state.time = Number(el.value);
      if (el.name === 'cuisine') state.cuisine = el.value;
      state.shown = PAGE;
      render();
      writeUrl(false);
    });
    // Open below its button on wider screens; on phones CSS makes it a bottom sheet.
    pop.addEventListener('toggle', (e) => {
      if ((e as ToggleEvent).newState !== 'open') return;
      updateCounts(pop);
      if (matchMedia('(max-width: 40rem)').matches) return;
      const btn = document.querySelector<HTMLElement>(`[popovertarget="${pop.id}"]`)!;
      const r = btn.getBoundingClientRect();
      pop.style.inset = 'auto';
      pop.style.top = `${r.bottom + 8}px`;
      pop.style.left = `${Math.max(16, Math.min(r.left, innerWidth - pop.offsetWidth - 16))}px`;
    });
  }
  addEventListener('scroll', () => document.querySelectorAll<HTMLElement>('.pop:popover-open').forEach((p) => p.hidePopover()), {
    passive: true,
  });
}

/** Each option's count, given everything else you've picked, so "Thai 12" means 12 here. */
function updateCounts(pop: HTMLElement) {
  const kind = pop.id.slice(2) as 'site' | 'time' | 'cuisine';
  const hits = isBlank() ? recipes.map((r) => ({ r })) : search({ skip: kind });
  for (const label of pop.querySelectorAll('label')) {
    const el = label.querySelector('input')!;
    const count = label.querySelector('.count')!;
    let n = 0;
    if (kind === 'site') n = hits.filter((h) => h.r.src.id === el.value).length;
    if (kind === 'time') n = Number(el.value) ? hits.filter((h) => h.r.min != null && h.r.min <= Number(el.value)).length : hits.length;
    if (kind === 'cuisine') n = el.value ? hits.filter((h) => h.r.cuisine === el.value).length : hits.length;
    count.textContent = n.toLocaleString();
  }
}

function renderFilterButtons() {
  const site = state.sites.size === 1 ? data.sources.find((s) => state.sites.has(s.id))!.name : state.sites.size ? `${state.sites.size} sites` : '';
  const set = (id: string, value: string) => {
    $(`${id}-value`).textContent = value;
    $(`${id}-btn`).toggleAttribute('data-active', !!value);
  };
  set('f-site', site);
  set('f-time', state.time ? `${state.time} min or less` : '');
  set('f-cuisine', state.cuisine);
  for (const el of document.querySelectorAll<HTMLInputElement>('.pop input')) {
    if (el.name === 'site') el.checked = state.sites.has(el.value);
    if (el.name === 'time') el.checked = Number(el.value) === state.time;
    if (el.name === 'cuisine') el.checked = el.value === state.cuisine;
  }
  $('clear-all').hidden = !(filterCount() || state.with.length || state.q);
}

// ---------------------------------------------------------------------------------------
// Start state and the "What's in here" list

function buildStart() {
  $('popular').innerHTML = data.popular
    .map(
      (p) =>
        `<li><button type="button" data-add="${p}" aria-label="${esc(data.ing[p][1].toLowerCase())}, ${plural(ingRecipes[p], 'recipe')}">${esc(
          data.ing[p][1].toLowerCase(),
        )} <span class="chip-count" aria-hidden="true">${ingRecipes[p].toLocaleString()}</span></button></li>`,
    )
    .join('');
  $('try').innerHTML = TRY.filter((t) => search({ q: t, with: [] }).length)
    .map((t) => `<li><button type="button" data-try="${esc(t)}">${esc(t)}</button></li>`)
    .join('');
}

function buildAbout() {
  const items = [
    ...data.sources.map(
      (s) =>
        `<li data-src="${esc(s.id)}"><span class="src-mark" aria-hidden="true"></span><span><a href="${esc(s.site)}">${esc(s.name)}</a> <span class="count">${plural(s.count, 'recipe')}</span></span></li>`,
    ),
    ...data.paused.map(
      (s) =>
        `<li><span class="src-mark" aria-hidden="true"></span><span><a href="${esc(s.site)}">${esc(s.name)}</a> <span class="why">not searchable yet: its site doesn’t answer our weekly job</span></span></li>`,
    ),
    ...data.videos.sources.map(
      (v) =>
        `<li data-src="youtube"><span class="src-mark" aria-hidden="true"></span><span><a href="${esc(v.channel)}">${esc(v.name)}</a> <span class="why">${
          data.videos.rows.length ? plural(data.videos.rows.length, 'YouTube video') : 'YouTube videos, coming soon'
        }</span></span></li>`,
    ),
    ...data.linkOnly
      .filter((l) => !/youtube/.test(l.search))
      .map(
        (l) =>
          `<li><span class="src-mark" aria-hidden="true"></span><span>${esc(l.name)} <span class="why">a link to its own search, since its owner doesn’t allow automated collection</span></span></li>`,
      ),
  ];
  $('sources-list').innerHTML = items.join('');
  if (data.crawled) {
    const d = new Date(data.crawled + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    $('crawled').textContent = `Last updated ${d}.`;
  }
}

// ---------------------------------------------------------------------------------------
// Typeahead (the ARIA combobox pattern: focus stays in the field, arrows move the
// highlighted option, Enter picks it)

type Option = { kind: 'ing'; p: number } | { kind: 'recipe'; h: Hit; n: number } | { kind: 'all' };
let options: Option[] = [];
let active = -1;

function suggest() {
  const raw = input.value.trim();
  const qw = words(raw);
  if (!qw.length) return closeList();
  const qs = qw.join(' ');
  const quality = (p: number) =>
    ingNames[p].some((n) => n === qs) ? 3 : ingNames[p].some((n) => n.startsWith(qs)) ? 2 : 1;
  const ings = data.ing
    .map((_, p) => p)
    .filter((p) => !state.with.includes(p) && ingRecipes[p] > 0 && ingNames[p].some((n) => n.startsWith(qs) || n.includes(` ${qs}`)))
    // An exact name first, then names that start with what you typed ("scal": scallion,
    // scallops), then a word inside one; within each, the most used first.
    .sort((a, b) => quality(b) - quality(a) || ingRecipes[b] - ingRecipes[a])
    .slice(0, 4);
  const hits = search({ q: raw });
  options = [
    ...ings.map((p) => ({ kind: 'ing' as const, p })),
    ...hits.slice(0, 4).map((h, n) => ({ kind: 'recipe' as const, h, n: n + 1 })),
    { kind: 'all' as const },
  ];
  active = -1;
  const opt = (o: Option, n: number) => {
    const id = `opt-${n}`;
    if (o.kind === 'ing')
    {
      // When it matched another name ("thai ginger" for galangal), say so.
      const names = data.ing[o.p].slice(4) as string[];
      const via = ingNames[o.p][0].startsWith(qs) || ingNames[o.p][0].includes(` ${qs}`)
        ? ''
        : names.find((_, k) => ingNames[o.p][k + 1].startsWith(qs) || ingNames[o.p][k + 1].includes(` ${qs}`)) || '';
      return `<div role="option" id="${id}" aria-selected="false" data-n="${n}"><span class="opt-plus" aria-hidden="true">+</span><span class="opt-text"><span>Add <strong>${esc(
        data.ing[o.p][1].toLowerCase(),
      )}</strong>${via ? ` <span class="opt-meta">(${esc(via)})</span>` : ''}</span><span class="opt-meta">${plural(ingRecipes[o.p], 'recipe')}</span></span></div>`;
    }
    if (o.kind === 'recipe') {
      const r = o.h.r;
      const thumb = r.img
        ? `<img class="opt-thumb" src="${esc(r.img)}" alt="" loading="lazy" referrerpolicy="no-referrer" width="40" height="40">`
        : `<span class="opt-thumb" aria-hidden="true"></span>`;
      return `<div role="option" id="${id}" aria-selected="false" data-n="${n}">${thumb}<span class="opt-text"><span>${highlight(
        r.name,
        qw,
      )}</span><span class="opt-meta">${esc(r.src.name)}${r.min ? ` · ${fmtTime(r.min)}` : ''}</span></span></div>`;
    }
    return `<div role="option" id="${id}" aria-selected="false" data-n="${n}"><span class="opt-text"><span>See all ${plural(
      hits.length,
      'result',
    )} for “${esc(raw)}”</span></span></div>`;
  };
  let html = '';
  let n = 0;
  if (ings.length)
    html += `<div role="group" aria-labelledby="g-ing"><div class="group-label" id="g-ing" role="presentation">Search by ingredient</div>${ings
      .map(() => opt(options[n], n++))
      .join('')}</div>`;
  const recipeCount = Math.min(4, hits.length);
  if (recipeCount)
    html += `<div role="group" aria-labelledby="g-rec"><div class="group-label" id="g-rec" role="presentation">Recipes</div>${Array.from(
      { length: recipeCount },
      () => opt(options[n], n++),
    ).join('')}</div>`;
  html += opt(options[n], n);
  listbox.innerHTML = html;
  panel.hidden = false;
  input.setAttribute('aria-expanded', 'true');
  input.removeAttribute('aria-activedescendant');
}

function closeList() {
  panel.hidden = true;
  input.setAttribute('aria-expanded', 'false');
  input.removeAttribute('aria-activedescendant');
  options = [];
  active = -1;
}

function setActive(n: number) {
  active = n;
  for (const el of listbox.querySelectorAll('[role="option"]')) el.setAttribute('aria-selected', String(el.id === `opt-${n}`));
  if (n < 0) return input.removeAttribute('aria-activedescendant');
  input.setAttribute('aria-activedescendant', `opt-${n}`);
  $(`opt-${n}`).scrollIntoView({ block: 'nearest' });
}

function choose(n: number) {
  const o = options[n];
  if (!o) return;
  if (o.kind === 'ing') {
    input.value = '';
    state.q = '';
    addIngredient(o.p, 'suggestions');
  } else if (o.kind === 'recipe') {
    openedRecipe(o.h.r.src.id, o.n, 'suggestions');
    location.href = o.h.r.url;
  } else {
    submit();
  }
}

// ---------------------------------------------------------------------------------------
// Actions

function addIngredient(p: number, from: string) {
  closeList();
  if (!state.with.includes(p)) state.with.push(p);
  state.shown = PAGE;
  render();
  writeUrl(true);
  track('Added Ingredient', { experiment: EXPERIMENT, ingredient_id: data.ing[p][0], added_from: from });
  searched();
}

function submit() {
  closeList();
  state.q = input.value.trim();
  state.shown = PAGE;
  render();
  writeUrl(true);
  searched();
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
  track('Opened Recipe', {
    experiment: EXPERIMENT,
    source,
    position,
    opened_from: from,
    ingredient_count: state.with.length,
  });
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
  if (active >= 0) return choose(active);
  submit();
});

input.addEventListener('input', () => (data ? suggest() : undefined));
input.addEventListener('focus', () => input.value.trim() && data && suggest());
input.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    if (panel.hidden) {
      if (data && input.value.trim()) suggest();
      e.preventDefault();
      return;
    }
    e.preventDefault();
    const last = options.length - 1;
    setActive(e.key === 'ArrowDown' ? (active >= last ? 0 : active + 1) : active <= 0 ? last : active - 1);
  } else if (e.key === 'Escape' && !panel.hidden) {
    e.preventDefault();
    closeList();
  } else if (e.key === 'Backspace' && !input.value && state.with.length) {
    // Backspace in an empty field takes off the last ingredient, like a tag field.
    state.with.pop();
    render();
    writeUrl(false);
  }
});
input.addEventListener('search', () => {
  // The field's own clear button.
  if (!input.value && state.q) submit();
});

// Keep focus in the field when an option is clicked.
listbox.addEventListener('mousedown', (e) => e.preventDefault());
listbox.addEventListener('click', (e) => {
  const el = (e.target as HTMLElement).closest<HTMLElement>('[role="option"]');
  if (el) choose(Number(el.dataset.n));
});
form.addEventListener('focusout', (e) => {
  if (!form.contains(e.relatedTarget as Node)) closeList();
});
document.addEventListener('click', (e) => {
  if (!form.contains(e.target as Node)) closeList();
});

app.addEventListener('click', (e) => {
  const el = (e.target as HTMLElement).closest<HTMLElement>('button, a');
  if (!el) return;
  if (el.dataset.add) addIngredient(Number(el.dataset.add), 'popular');
  else if (el.dataset.try) {
    input.value = el.dataset.try;
    submit();
  } else if (el.dataset.remove) {
    state.with = state.with.filter((p) => p !== Number(el.dataset.remove));
    state.shown = PAGE;
    render();
    writeUrl(true);
    input.focus();
  } else if (el.dataset.fix) {
    if (el.dataset.fix === 'clear') clearAll();
    else emptyFixes[Number(el.dataset.fix)]?.();
    state.shown = PAGE;
    render();
    writeUrl(true);
  } else if (el.dataset.pos) {
    openedRecipe(el.dataset.srcId || '', Number(el.dataset.pos), 'results');
  } else if (el.dataset.srcId === 'youtube') {
    openedRecipe('youtube', 0, 'videos');
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
}

$('clear-all').addEventListener('click', () => {
  clearAll();
  state.shown = PAGE;
  render();
  writeUrl(true);
  input.focus();
});

moreBtn.addEventListener('click', () => {
  const first = state.shown;
  state.shown += PAGE;
  render();
  // Move focus to the first new result, so keyboard and screen reader users keep their place.
  resultsEl.querySelectorAll<HTMLAnchorElement>('h3 a')[first]?.focus();
});

// A photo that won't load (moved, blocked) falls back to the site's name.
resultsEl.addEventListener(
  'error',
  (e) => {
    const img = e.target as HTMLImageElement;
    if (img.tagName !== 'IMG') return;
    const name = img.closest<HTMLElement>('.card')?.querySelector('.src')?.textContent?.split(' · ')[0] || '';
    img.replaceWith(Object.assign(document.createElement('span'), { className: 'no-photo', textContent: name }));
  },
  true,
);

addEventListener('popstate', () => {
  if (!data) return;
  readUrl();
  render();
});

load();
