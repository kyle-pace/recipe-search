// Checks for the MCP search, on a small made-up index in the shape scripts/build-index.mjs writes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ingredientFor, listSources, prepare, searchRecipes, words } from './search.mjs';

// ing: [id, name, recipe count, parent positions, ...other names]
const ing = [
  ['pork', 'Pork', 2, []], // 0
  ['pork-belly', 'Pork belly', 1, [0]], // 1
  ['tofu', 'Tofu', 2, [], 'bean curd'], // 2
  ['scallions', 'Scallions', 3, [], 'green onion'], // 3
  ['bok-choy', 'Bok choy', 1, [], 'pak choi'], // 4
  ['rice-noodles', 'Rice noodles', 1, []], // 5
];
// recipes: [source, name, path, minutes, cuisine, all ingredient positions, its own, photo, keywords, opens]
const index = {
  crawled: '2026-11-09',
  sources: [
    { id: 'woks', name: 'The Woks of Life', site: 'https://thewoksoflife.com', host: 'thewoksoflife.com', count: 3 },
    { id: 'htk', name: 'Hot Thai Kitchen', site: 'https://hot-thai-kitchen.com', host: 'hot-thai-kitchen.com', count: 2 },
  ],
  videos: {
    sources: [
      { id: 'woks-yt', name: 'The Woks of Life', channel: 'https://www.youtube.com/@woks', site: 'woks', count: 1 },
      { id: 'kenji', name: 'J. Kenji López-Alt', channel: 'https://www.youtube.com/@kenji', site: '', count: 1 },
    ],
    rows: [
      [0, 'Restaurant Mapo Tofu', 'abc123', '2026-01-02', [2]],
      [1, 'Late Night Mapo Tofu', 'def456', '2026-03-04', [2]],
    ],
  },
  support: { htk: [{ label: 'Patreon', url: 'https://www.patreon.com/x' }], woks: [{ label: 'The Woks of Life', url: 'https://bookshop.org/book/1', book: true }] },
  linkOnly: [{ name: 'Serious Eats', search: 'https://www.seriouseats.com/search?q={q}' }],
  cuisines: [['Chinese', 3], ['Thai', 2]],
  diet: { vegetarian: [0, 1], vegan: [0, 1] },
  ing,
  recipes: [
    [0, 'Mapo Tofu', '/mapo-tofu/', 30, 'Chinese', [0, 2, 3], [0, 2, 3], 'x.jpg', 'sichuan', 5],
    [0, 'Vegan Mapo Tofu', '/vegan-mapo-tofu/', 25, 'Chinese', [2, 3], [2, 3], 'x.jpg', '', 0],
    [0, 'Red Braised Pork Belly', '/pork-belly/', 90, 'Chinese', [1, 0, 3], [1, 3], 'x.jpg', 'hong shao rou', 0],
    [1, 'Pad See Ew', '/pad-see-ew/', 20, 'Thai', [5, 0], [5, 0], 'x.jpg', 'stir fried noodles', 0],
    [1, 'Stir-Fried Bok Choy', '/bok-choy/', 10, 'Thai', [4], [4], '', '', 0],
  ],
};
const ready = prepare(index);
const names = (r) => r.recipes.map((x) => x.name);

test('words are lowercase, singular and accent-free', () => {
  assert.deepEqual(words('Scallions, chopped!'), ['scallion', 'chopped']);
  assert.deepEqual(words('Jalapeños & tomatoes'), ['jalapeno', 'tomato']);
});

test('ingredients are found by any of their names', () => {
  assert.equal(ingredientFor(ready, 'green onions'), 3);
  assert.equal(ingredientFor(ready, 'Bean Curd'), 2);
  assert.equal(ingredientFor(ready, 'saffron'), null);
});

test('a dish search needs every word and gives full links', () => {
  const r = searchRecipes(ready, { query: 'mapo tofu' });
  assert.deepEqual(names(r).sort(), ['Mapo Tofu', 'Vegan Mapo Tofu']);
  assert.equal(r.recipes.find((x) => x.name === 'Mapo Tofu').url, 'https://thewoksoflife.com/mapo-tofu/');
  assert.equal(r.videos.length, 2);
  assert.ok(r.videos.every((v) => v.on === 'YouTube' && v.url.startsWith('https://www.youtube.com/watch?v=')));
});

test('cooking with ingredients: most used first, a parent covers its kinds', () => {
  const r = searchRecipes(ready, { ingredients: ['pork', 'tofu', 'scallions'] });
  assert.equal(r.recipes[0].name, 'Mapo Tofu');
  assert.deepEqual(r.recipes[0].also_needs, []);
  const belly = r.recipes.find((x) => x.name === 'Red Braised Pork Belly');
  assert.deepEqual(belly.uses, ['Pork', 'Scallions']);
  assert.deepEqual(belly.also_needs, []); // pork covers pork belly
  assert.deepEqual(r.cooking_with, ['Pork', 'Tofu', 'Scallions']);
  assert.ok(!names(r).includes('Stir-Fried Bok Choy'));
});

test('without, diet, cuisine, time and creator narrow the results', () => {
  assert.deepEqual(names(searchRecipes(ready, { query: 'mapo tofu', without: ['pork'] })), ['Vegan Mapo Tofu']);
  assert.deepEqual(names(searchRecipes(ready, { query: 'tofu', diet: 'vegetarian' })), ['Vegan Mapo Tofu']);
  assert.deepEqual(names(searchRecipes(ready, { cuisine: 'thai', max_minutes: 15 })), ['Stir-Fried Bok Choy']);
  assert.equal(searchRecipes(ready, { creator: 'hot thai kitchen' }).total_recipes, 2);
  assert.equal(searchRecipes(ready, { creator: 'Woks of Life', max_minutes: 30 }).total_recipes, 2);
});

test('videos stay out when a cuisine or time is asked for, or when turned off', () => {
  assert.equal(searchRecipes(ready, { query: 'mapo tofu', cuisine: 'Chinese' }).videos, undefined);
  assert.equal(searchRecipes(ready, { query: 'mapo tofu', videos: false }).videos, undefined);
});

test('unknown things are explained, not silently dropped', () => {
  assert.match(searchRecipes(ready, { ingredients: ['tofu', 'saffron'] }).notes.join(' '), /saffron/);
  const bad = searchRecipes(ready, { cuisine: 'martian' });
  assert.match(bad.error, /martian/);
  assert.deepEqual(bad.cuisines, ['Chinese', 'Thai']);
  const none = searchRecipes(ready, { query: 'croissant' });
  assert.equal(none.total_recipes, 0);
  assert.equal(none.also_search[0].search, 'https://www.seriouseats.com/search?q=croissant');
});

test('limit caps the list and says how many there are', () => {
  const r = searchRecipes(ready, { ingredients: ['scallions'], limit: 1 });
  assert.equal(r.recipes.length, 1);
  assert.equal(r.total_recipes, 3);
  assert.match(r.notes.join(' '), /1 of 3/);
});

test('list_sources joins a site with its channel and lists support links', () => {
  const s = listSources(ready);
  const woks = s.creators.find((c) => c.name === 'The Woks of Life');
  assert.equal(woks.recipes, 3);
  assert.equal(woks.videos, 1);
  assert.equal(woks.support[0].label, 'Book: The Woks of Life');
  assert.ok(s.creators.some((c) => c.name === 'J. Kenji López-Alt' && c.videos === 1));
  assert.deepEqual(s.not_indexed_but_searchable, ['Serious Eats']);
});
