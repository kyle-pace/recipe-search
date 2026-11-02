// Reads the recipe facts we keep from a page: JSON-LD (most sites) or
// schema.org microdata (Smitten Kitchen). Returns null when the page has
// no recipe. Only the fields in KEEP below ever leave this file.

import { clean, decodeEntities, toMinutes } from './text.mjs';
import { ingredientNames } from './ingredients.mjs';

// n: name, u: link, t: total minutes, c: cuisine, k: course, y: yield,
// i: ingredient names, img: photo link, kw: a few keywords (for recipes
// whose ingredient list is empty, like Maangchi's older ones).
const KEEP = ['n', 'u', 't', 'c', 'k', 'y', 'i', 'img', 'kw'];

export function extractRecipe(html, pageUrl, { format = 'json-ld', defaultCuisine } = {}) {
  let raw = null;
  if (format === 'microdata') raw = fromMicrodata(html) || fromJsonLd(html);
  else raw = fromJsonLd(html) || fromMicrodata(html);
  if (!raw || !raw.name) return null;

  const recipe = {
    n: clean(raw.name),
    u: pageUrl,
    t: toMinutes(raw.totalTime) ?? sumTimes(raw.prepTime, raw.cookTime),
    c: first(raw.recipeCuisine) || defaultCuisine || null,
    k: first(raw.recipeCategory) || null,
    y: yieldText(raw.recipeYield),
    i: ingredientNames(asArray(raw.recipeIngredient || raw.ingredients)),
    img: imageUrl(raw.image) || ogImage(html),
    kw: keywords(raw.keywords),
  };
  if (recipe.img) recipe.img = absolute(recipe.img, pageUrl);
  const out = {};
  for (const key of KEEP) {
    const v = recipe[key];
    if (v == null || v === '' || (Array.isArray(v) && !v.length)) continue;
    out[key] = v;
  }
  return out;
}

// ---- JSON-LD

export function fromJsonLd(html) {
  for (const m of String(html).matchAll(/<script[^>]*type=["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi)) {
    const data = parseJson(m[1]);
    if (data == null) continue;
    const found = findRecipe(data);
    if (found) return found;
  }
  return null;
}

function parseJson(text) {
  const t = text.trim().replace(/^<!\[CDATA\[|\]\]>$/g, '');
  try {
    return JSON.parse(t);
  } catch {
    try {
      return JSON.parse(t.replace(/[\u0000-\u001f]+/g, ' '));
    } catch {
      return null;
    }
  }
}

function isRecipe(node) {
  const type = node && node['@type'];
  return Array.isArray(type) ? type.includes('Recipe') : type === 'Recipe';
}

function findRecipe(node, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 6) return null;
  if (Array.isArray(node)) {
    for (const n of node) {
      const r = findRecipe(n, depth + 1);
      if (r) return r;
    }
    return null;
  }
  if (isRecipe(node)) return node;
  for (const key of ['@graph', 'mainEntity', 'mainEntityOfPage', 'hasPart', 'itemListElement', 'item']) {
    const r = findRecipe(node[key], depth + 1);
    if (r) return r;
  }
  return null;
}

// ---- Microdata

export function fromMicrodata(html) {
  const s = String(html);
  const start = s.search(/itemtype=["']https?:\/\/schema\.org\/Recipe["']/i);
  if (start < 0) return null;
  const chunk = s.slice(start, start + 120000);
  const props = {};
  for (const m of chunk.matchAll(/<([a-z][a-z0-9]*)\b([^>]*\bitemprop=["']([^"']+)["'][^>]*)>/gi)) {
    const [, tag, attrs, propList] = m;
    let value = attr(attrs, 'content') ?? attr(attrs, 'datetime');
    if (value == null && /^(img|source)$/i.test(tag)) value = attr(attrs, 'src');
    if (value == null && /^(a|link)$/i.test(tag)) value = attr(attrs, 'href');
    if (value == null) {
      const rest = chunk.slice(m.index + m[0].length);
      const close = rest.search(new RegExp(`</${tag}\\s*>`, 'i'));
      value = close >= 0 ? clean(rest.slice(0, close)) : '';
    }
    for (const prop of propList.split(/\s+/)) {
      (props[prop] ||= []).push(decodeEntities(value));
    }
  }
  if (!props.name) return null;
  return {
    name: props.name[0],
    totalTime: props.totalTime?.[0],
    prepTime: props.prepTime?.[0],
    cookTime: props.cookTime?.[0],
    recipeYield: props.recipeYield?.[0],
    recipeCuisine: props.recipeCuisine?.[0],
    recipeCategory: props.recipeCategory?.[0],
    recipeIngredient: props.recipeIngredient || props.ingredients || [],
    image: props.image?.[0],
    keywords: props.keywords?.[0],
  };
}

function attr(attrs, name) {
  const m = attrs.match(new RegExp(`\\b${name}=(?:"([^"]*)"|'([^']*)')`, 'i'));
  return m ? (m[1] ?? m[2]) : null;
}

// ---- Field helpers

function asArray(v) {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

function first(v) {
  for (const x of asArray(v)) {
    const s = clean(typeof x === 'object' ? x?.name : x);
    if (s) return s.split(/\s*,\s*/)[0];
  }
  return null;
}

function yieldText(v) {
  const values = asArray(v).map((x) => clean(x)).filter(Boolean);
  // WP Recipe Maker gives ["4", "4 servings"]; prefer the one with words.
  return values.find((x) => /[a-z]/i.test(x)) || values[0] || null;
}

function sumTimes(a, b) {
  const x = toMinutes(a);
  const y = toMinutes(b);
  return x == null && y == null ? null : (x || 0) + (y || 0);
}

function imageUrl(v) {
  for (const x of asArray(v)) {
    if (typeof x === 'string' && x) return x;
    if (x && typeof x === 'object' && (x.url || x.contentUrl)) return x.url || x.contentUrl;
  }
  return null;
}

function ogImage(html) {
  const m = String(html).match(/<meta[^>]+property=["']og:image["'][^>]*>/i);
  if (!m) return null;
  const c = m[0].match(/content=["']([^"']+)["']/i);
  return c ? decodeEntities(c[1]) : null;
}

function keywords(v) {
  const words = asArray(v)
    .flatMap((x) => String(x).split(','))
    .map((x) => clean(x).toLowerCase())
    .filter((x) => x && x.length < 40);
  return [...new Set(words)].slice(0, 12);
}

function absolute(href, base) {
  try {
    return new URL(href, base).href;
  } catch {
    return href;
  }
}
