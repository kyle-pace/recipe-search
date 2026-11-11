// The answers behind the MCP tools (src/pages/recipe-search/mcp.ts): plain functions over the
// same index the search page loads (public/recipe-search/index.json, from
// scripts/build-index.mjs). No network and no MCP here, so `npm test` can run them.
//
// The rules follow the page's own search (src/scripts/search.ts): words must be in a recipe's
// name or keywords, ingredients are KitchenCatalog items ("pork" covers pork belly), results
// that use more of your ingredients and need fewer others come first, and creators take turns.
// It leaves out the page's typo fixing; assistants spell well enough.

export const SITE = 'https://kylepace.dev/recipe-search/';

/** "Scallions, chopped!" -> ["scallion", "chopped"]: lowercase, no accents, singular words. */
export function words(text) {
  return String(text ?? '')
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

const list = (v) => (Array.isArray(v) ? v : v ? String(v).split(/[,;\n]/) : []).map((s) => String(s).trim()).filter(Boolean);

/**
 * Get the index ready to search, once: each recipe's words, each ingredient's names, and
 * who the creators are (a site, a site and its YouTube channel, or a channel alone).
 */
export function prepare(index) {
  const ingNames = index.ing.map((g) => [g[1], ...g.slice(4)].map((n) => words(n).join(' ')));
  const ingUsed = index.ing.map(() => 0);
  const recipes = index.recipes.map((r) => {
    for (const p of r[5]) ingUsed[p]++;
    const title = words(r[1]);
    return {
      src: index.sources[r[0]],
      name: r[1],
      url: r[2].startsWith('http') ? r[2] : index.sources[r[0]].site + r[2],
      min: r[3],
      cuisine: r[4],
      pos: new Set(r[5]),
      own: r[6],
      hasPhoto: Boolean(r[7]),
      title,
      titleText: ` ${title.join(' ')}`,
      other: words(`${r[8]} ${index.sources[r[0]].name}`),
      opens: r[9] || 0,
    };
  });

  const creators = new Map();
  for (const s of index.sources) creators.set(s.id, { id: s.id, name: s.name, site: s.site, recipes: s.count, videos: 0 });
  const channelCreator = index.videos.sources.map((c) => {
    const id = c.site || c.id;
    const known = creators.get(id) ?? { id, name: c.name, site: '', recipes: 0, videos: 0 };
    known.videos += c.count;
    known.youtube = c.channel;
    creators.set(id, known);
    return id;
  });

  return { index, recipes, ingNames, ingUsed, creators, channelCreator, videoWords: null };
}

/** The ingredient a phrase names exactly (any of its names, singular or plural), or null. */
export function ingredientFor(ready, phrase) {
  const want = words(phrase).join(' ');
  if (!want) return null;
  const { ingNames, ingUsed } = ready;
  let found = null;
  for (let p = 0; p < ingNames.length; p++) {
    if (!ingUsed[p]) continue;
    if (ingNames[p][0] === want) return p; // its main name wins over another item's other name
    if (found == null && ingNames[p].includes(want)) found = p;
  }
  return found;
}

function creatorFor(ready, phrase) {
  const want = words(phrase).join(' ');
  if (!want) return null;
  const all = [...ready.creators.values()];
  const name = (c) => words(c.name).join(' ');
  return (
    all.find((c) => c.id === phrase || name(c) === want) ??
    all.find((c) => name(c).includes(want) || want.includes(name(c))) ??
    all.find((c) => c.site && want.replace(/ /g, '').includes(words(new URL(c.site).hostname.replace(/^www\./, '').split('.')[0]).join(''))) ??
    null
  );
}

function cuisineFor(ready, wanted) {
  const want = words(wanted).join(' ');
  const hit = ready.index.cuisines.find(([c]) => words(c).join(' ') === want);
  return hit ? hit[0] : null;
}

/** How well a recipe's words match the query words; 0 means it doesn't. */
function textScore(r, q, loose) {
  if (!q.length) return 1;
  let score = 0;
  let missed = 0;
  for (const [n, t] of q.entries()) {
    const last = n === q.length - 1;
    const hit = (w) => w === t || (last && t.length > 1 && w.startsWith(t));
    if (r.title.some(hit)) score += r.title.includes(t) ? 8 : 6;
    else if (r.other.some(hit)) score += 3;
    else if (!loose) return 0;
    else missed++;
  }
  if (loose && (missed === q.length || missed > Math.floor(q.length / 2))) return 0;
  if (q.length > 1 && r.titleText.includes(` ${q.join(' ')}`)) score += 10;
  return score - missed * 100;
}

const popBonus = (r) => Math.min(4, Math.log2(1 + r.opens));

/** Take turns between creators among results that are about as good as each other. */
function mix(hits, byIngredients) {
  const out = [];
  const tierOf = (h) => (byIngredients ? h.used.length : 0);
  for (let i = 0; i < hits.length; ) {
    let j = i;
    while (j < hits.length && tierOf(hits[j]) === tierOf(hits[i])) j++;
    const pool = hits.slice(i, j);
    const recent = [];
    // Only the front of the list is ever returned, so stop mixing once it's long enough.
    while (pool.length && out.length < 80) {
      const top = pool[0];
      const close = (h) => (byIngredients ? h.missing <= top.missing + 1 : h.score >= top.score - 2);
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
    if (out.length >= 80) break;
    i = j;
  }
  return out;
}

function findRecipes(ready, f, loose) {
  const { index } = ready;
  const covers = (p) => f.with.includes(p) || index.ing[p][3].some((parent) => f.with.includes(parent));
  const hits = [];
  for (const r of ready.recipes) {
    if (f.creator && r.src.id !== f.creator.id) continue;
    if (f.maxMinutes && (r.min == null || r.min > f.maxMinutes)) continue;
    if (f.cuisine && r.cuisine !== f.cuisine) continue;
    if (f.out.size && [...r.pos].some((p) => f.out.has(p))) continue;
    if (f.notWords.length && f.notWords.some((w) => r.title.includes(w))) continue;
    const t = textScore(r, f.q, loose);
    if (!t) continue;
    let used = [];
    let missing = 0;
    if (f.with.length) {
      used = f.with.filter((p) => r.pos.has(p));
      if (!used.length) continue;
      missing = r.own.filter((p) => !covers(p)).length;
    }
    hits.push({ r, score: t + popBonus(r), used, missing });
  }
  const sorted = f.q.length || f.with.length;
  hits.sort(
    (a, b) =>
      b.used.length - a.used.length ||
      (f.with.length ? a.missing - b.missing : 0) ||
      b.score - a.score ||
      Number(b.r.hasPhoto) - Number(a.r.hasPhoto) ||
      (sorted ? (a.r.min ?? 999) - (b.r.min ?? 999) : a.r.name.localeCompare(b.r.name)),
  );
  return { total: hits.length, hits: mix(hits, f.with.length > 0) };
}

/** Videos whose title (or channel) has every word, newest first, channels taking turns. */
function findVideos(ready, f, limit) {
  const { index } = ready;
  if (!f.q.length && !f.creator) return [];
  ready.videoWords ??= index.videos.rows.map((v) => words(v[1]));
  const chanWords = index.videos.sources.map((c) => words(c.name));
  const byChannel = new Map();
  index.videos.rows.forEach((v, n) => {
    if (f.creator && ready.channelCreator[v[0]] !== f.creator.id) return;
    if (f.out.size && v[4].some((p) => f.out.has(p))) return;
    const t = ready.videoWords[n];
    if (f.notWords.length && f.notWords.some((w) => t.includes(w))) return;
    if (f.with.length && !v[4].some((p) => f.with.includes(p))) return;
    if (f.q.length && !f.q.every((w, k) => [...t, ...chanWords[v[0]]].some((x) => x === w || (k === f.q.length - 1 && x.startsWith(w))))) return;
    byChannel.set(v[0], [...(byChannel.get(v[0]) || []), v]);
  });
  const queues = [...byChannel.values()].map((q) => q.sort((a, b) => String(b[3]).localeCompare(String(a[3]))));
  const out = [];
  for (let round = 0; out.length < limit && queues.some((q) => q.length > round); round++) {
    for (const q of queues) if (q[round] && out.length < limit) out.push(q[round]);
  }
  return out.map((v) => ({
    title: v[1],
    url: `https://www.youtube.com/watch?v=${v[2]}`,
    channel: index.videos.sources[v[0]].name,
    on: 'YouTube',
    ...(v[3] ? { published: String(v[3]).slice(0, 10) } : {}),
  }));
}

const fmtTime = (m) => (m < 60 ? `${m} min` : `${Math.floor(m / 60)} hr${m % 60 ? ` ${m % 60} min` : ''}`);

/**
 * Search the index. Everything is optional:
 *   query        words for the dish, matched in recipe names and keywords ("mapo tofu")
 *   ingredients  things to cook with; a recipe must use at least one, more is better
 *   without      ingredients to leave out
 *   diet         "vegetarian" or "vegan" (a best guess from ingredient lists)
 *   cuisine, max_minutes, creator, limit, videos
 */
export function searchRecipes(ready, opts = {}) {
  const { index } = ready;
  const notes = [];
  const limit = Math.min(Math.max(Number(opts.limit) || 10, 1), 30);
  const name = (p) => index.ing[p][1];

  const f = { q: words(opts.query), with: [], out: new Set(), notWords: [], creator: null, cuisine: '', maxMinutes: Number(opts.max_minutes) || 0 };

  const unknown = [];
  for (const phrase of list(opts.ingredients)) {
    const p = ingredientFor(ready, phrase);
    if (p == null) unknown.push(phrase);
    else if (!f.with.includes(p)) f.with.push(p);
  }
  if (unknown.length) {
    // Not a catalog ingredient: look for it in recipe names instead, when nothing else was asked for.
    if (!f.with.length && !f.q.length) f.q = words(unknown.join(' '));
    notes.push(`Not ingredients this index knows by that name: ${unknown.join(', ')}.${f.with.length || words(opts.query).length ? ' They were left out of the search.' : ' Searched recipe names for them instead.'}`);
  }

  for (const phrase of list(opts.without)) {
    const p = ingredientFor(ready, phrase);
    if (p == null) f.notWords.push(...words(phrase).slice(0, 1));
    else f.out.add(p);
  }
  if (opts.diet === 'vegetarian' || opts.diet === 'vegan') {
    for (const p of index.diet?.[opts.diet] || []) f.out.add(p);
    notes.push(`${opts.diet === 'vegan' ? 'Vegan' : 'Vegetarian'} is a best guess from ingredient lists; check the recipe.`);
  }

  if (opts.cuisine) {
    f.cuisine = cuisineFor(ready, opts.cuisine);
    if (!f.cuisine) return { error: `No cuisine matches "${opts.cuisine}".`, cuisines: index.cuisines.map(([c]) => c) };
  }
  if (opts.creator) {
    f.creator = creatorFor(ready, opts.creator);
    if (!f.creator) return { error: `No creator matches "${opts.creator}".`, creators: [...ready.creators.values()].map((c) => c.name) };
  }

  let found = findRecipes(ready, f, false);
  if (!found.total && f.q.length > 1) {
    found = findRecipes(ready, f, true);
    if (found.total) notes.push('Nothing has every word, so these have most of them.');
  }

  const recipes = found.hits.slice(0, limit).map((h) => {
    const out = { name: h.r.name, url: h.r.url, from: h.r.src.name };
    if (h.r.min) out.time = fmtTime(h.r.min);
    if (h.r.cuisine) out.cuisine = h.r.cuisine;
    if (f.with.length) {
      out.uses = h.used.map(name);
      const covers = (p) => f.with.includes(p) || index.ing[p][3].some((parent) => f.with.includes(parent));
      const need = h.r.own.filter((p) => !covers(p)).map(name);
      out.also_needs = need.length > 12 ? [...need.slice(0, 12), `and ${need.length - 12} more`] : need;
    }
    return out;
  });

  // Videos have no cuisine or time in the index, so they only come along when neither is asked for.
  const wantVideos = opts.videos !== false && !f.cuisine && !f.maxMinutes;
  const videos = wantVideos ? findVideos(ready, f, Math.min(5, limit)) : [];

  if (found.total > recipes.length) notes.push(`Showing ${recipes.length} of ${found.total} recipes. Add words, ingredients or filters to narrow it, or raise limit (up to 30).`);
  if (!found.total && !videos.length) {
    const q = encodeURIComponent(String(opts.query || list(opts.ingredients).join(' ')));
    const also = (index.linkOnly || []).map((l) => ({ name: l.name, search: l.search.replace('{q}', q) }));
    if (q && also.length) return { total_recipes: 0, recipes: [], notes: [...notes, 'Nothing in the index. These sites are not indexed here but can be searched directly.'], also_search: also, source: SITE };
  }

  return {
    total_recipes: found.total,
    recipes,
    ...(videos.length ? { videos } : {}),
    ...(f.with.length ? { cooking_with: f.with.map(name) } : {}),
    ...(notes.length ? { notes } : {}),
    crawled: index.crawled,
    source: SITE,
  };
}

/** Who is in the index, how to support them, and what can be filtered on. */
export function listSources(ready) {
  const { index } = ready;
  return {
    about: 'One search across recipe sites Kyle Pace trusts, from a small index of names, links, ingredient names, times and cuisines. It never holds the method: every result links to the original recipe.',
    creators: [...ready.creators.values()].map((c) => ({
      name: c.name,
      ...(c.site ? { site: c.site } : {}),
      ...(c.recipes ? { recipes: c.recipes } : {}),
      ...(c.videos ? { videos: c.videos, youtube: c.youtube } : {}),
      ...(index.support?.[c.id]?.length ? { support: index.support[c.id].map((s) => ({ label: s.book ? `Book: ${s.label}` : s.label, url: s.url })) } : {}),
    })),
    not_indexed_but_searchable: (index.linkOnly || []).map((l) => l.name),
    cuisines: index.cuisines.map(([c, n]) => `${c} (${n})`),
    recipe_count: index.recipes.length,
    video_count: index.videos.rows.length,
    crawled: index.crawled,
    source: SITE,
    more: `${SITE}about/`,
  };
}
