import { test } from 'node:test';
import assert from 'node:assert/strict';
import { robotsFor } from '../lib/robots.mjs';
import { parseSitemap, readSitemaps } from '../lib/sitemap.mjs';
import { extractRecipe } from '../lib/extract.mjs';
import { ingredientName } from '../lib/ingredients.mjs';
import { toMinutes } from '../lib/text.mjs';
import { toVideo, seconds, fetchChannelVideos } from '../lib/youtube.mjs';
import { totals } from '../lib/popularity.mjs';
import { adapt, readSources } from '../lib/sources.mjs';

test('robots: AI-bot blocks leave us alone; wp-json stays off limits', () => {
  const txt = `User-agent: GPTBot\nDisallow: /\n\nUser-agent: CCBot\nDisallow: /\n\nUser-agent: *\nDisallow: /wp-json/\nDisallow: /wp-admin/\nAllow: /wp-admin/admin-ajax.php\n`;
  const r = robotsFor(txt, 'RecipeSearchBot');
  assert.equal(r.allowed('https://thewoksoflife.com/mapo-tofu/'), true);
  assert.equal(r.allowed('/wp-json/wp/v2/posts'), false);
  assert.equal(r.allowed('/wp-admin/admin-ajax.php'), true);
});

test('robots: a group naming us wins, with crawl-delay; wildcards and $', () => {
  const txt = `User-agent: *\nDisallow:\n\nUser-agent: RecipeSearchBot\nDisallow: /*?s=\nDisallow: /*.pdf$\nCrawl-delay: 10\n`;
  const r = robotsFor(txt, 'Mozilla/5.0 (compatible; RecipeSearchBot/0.1)');
  assert.equal(r.crawlDelay, 10);
  assert.equal(r.allowed('/?s=tofu'), false);
  assert.equal(r.allowed('/menu.pdf'), false);
  assert.equal(r.allowed('/menu.pdf?x=1'), true);
  assert.equal(r.allowed('/recipe/kimchi'), true);
});

test('robots: Disallow: / for everyone blocks us', () => {
  assert.equal(robotsFor('User-agent: *\nDisallow: /', 'RecipeSearchBot').allowed('/x'), false);
  assert.equal(robotsFor('', 'RecipeSearchBot').allowed('/x'), true);
});

test('sitemap: index and urlset, with skipped child sitemaps', async () => {
  const index = `<?xml version="1.0"?><sitemapindex><sitemap><loc>https://x.com/post-sitemap.xml</loc></sitemap><sitemap><loc>https://x.com/post-sitemap2.xml</loc></sitemap><sitemap><loc>https://x.com/category-sitemap.xml</loc></sitemap><sitemap><loc>https://x.com/page-sitemap.xml</loc></sitemap></sitemapindex>`;
  const posts = (n) => `<urlset><url><loc>https://x.com/a${n}/</loc><lastmod>2026-10-0${n}T10:00:00+00:00</lastmod></url><url><loc><![CDATA[https://x.com/b${n}/?a=1&amp;b=2]]></loc></url></urlset>`;
  assert.equal(parseSitemap(index).isIndex, true);
  const fetched = [];
  const got = await readSitemaps('https://x.com/sitemap_index.xml', async (u) => {
    fetched.push(u);
    return u.endsWith('index.xml') ? index : posts(u.includes('2') ? 2 : 1);
  });
  assert.deepEqual(fetched, ['https://x.com/sitemap_index.xml', 'https://x.com/post-sitemap.xml', 'https://x.com/post-sitemap2.xml']);
  assert.equal(got.length, 4);
  assert.equal(got[0].lastmod, '2026-10-01T10:00:00+00:00');
  assert.equal(got[1].loc, 'https://x.com/b1/?a=1&b=2');
});

test('sitemap: include pattern keeps only recipe pages', async () => {
  const xml = `<urlset><url><loc>https://www.maangchi.com/recipe/kimchi</loc></url><url><loc>https://www.maangchi.com/talk/thread</loc></url></urlset>`;
  const got = await readSitemaps('https://www.maangchi.com/sitemap.xml', async () => xml, { include: /\/recipe\// });
  assert.deepEqual(got.map((e) => e.loc), ['https://www.maangchi.com/recipe/kimchi']);
});

const WPRM_PAGE = `<html><head><meta property="og:image" content="https://x.com/og.jpg">
<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"WebPage","name":"page"},
{"@type":"Article","headline":"Mapo Tofu"},
{"@type":"Recipe","name":"Mapo Tofu &#8211; Real Deal","image":["https://x.com/mapo-1x1.jpg","https://x.com/mapo-4x3.jpg"],
"recipeYield":["6","6 servings"],"prepTime":"PT10M","cookTime":"PT20M","totalTime":"PT30M",
"recipeIngredient":["1/2 cup oil (divided)","1-2 fresh Thai bird chili peppers (optional)","6-8 dried red chilies","1 1/2 tablespoons ginger (finely minced)","3 cloves garlic, finely minced","8 ounces ground pork","1 (16-ounce) package silken tofu, cut into 1&quot; cubes","¼ teaspoon Sichuan peppercorn powder","Salt, to taste","For the sauce:","2 scallions"],
"recipeInstructions":[{"@type":"HowToStep","text":"SECRET METHOD"}],
"recipeCategory":["Main Course"],"recipeCuisine":["Chinese"],"keywords":"mapo tofu, sichuan"}]}</script></head><body>…</body></html>`;

test('JSON-LD: WP Recipe Maker graph, names only, no method', () => {
  const r = extractRecipe(WPRM_PAGE, 'https://x.com/mapo-tofu/');
  assert.equal(r.n, 'Mapo Tofu – Real Deal');
  assert.equal(r.t, 30);
  assert.equal(r.y, '6 servings');
  assert.equal(r.c, 'Chinese');
  assert.equal(r.k, 'Main Course');
  assert.equal(r.img, 'https://x.com/mapo-1x1.jpg');
  assert.deepEqual(r.i, ['oil', 'fresh thai bird chili peppers', 'dried red chilies', 'ginger', 'garlic', 'ground pork', 'silken tofu', 'sichuan peppercorn powder', 'salt', 'scallions']);
  assert.deepEqual(r.kw, ['mapo tofu', 'sichuan']);
  assert.ok(!JSON.stringify(r).includes('SECRET'));
  assert.deepEqual(Object.keys(r).sort(), ['c', 'i', 'img', 'k', 'kw', 'n', 't', 'u', 'y']);
});

test('JSON-LD: default cuisine, prep+cook when no total, empty ingredients kept out', () => {
  const page = `<script type="application/ld+json">[{"@type":["Recipe"],"name":"Kimchi","cookTime":"PT1H","prepTime":"PT15M","recipeIngredient":[],"image":{"@type":"ImageObject","url":"/k.jpg"}}]</script>`;
  const r = extractRecipe(page, 'https://www.maangchi.com/recipe/kimchi', { defaultCuisine: 'Korean' });
  assert.equal(r.t, 75);
  assert.equal(r.c, 'Korean');
  assert.equal(r.i, undefined);
  assert.equal(r.img, 'https://www.maangchi.com/k.jpg');
});

test('no recipe on the page gives null', () => {
  assert.equal(extractRecipe('<script type="application/ld+json">{"@type":"Article","name":"x"}</script>', 'https://x.com/'), null);
  assert.equal(extractRecipe('<script type="application/ld+json">{ broken</script>', 'https://x.com/'), null);
});

const JETPACK_PAGE = `<meta property="og:image" content="https://i0.wp.com/smittenkitchen.com/pierogi.jpg">
<div class="jetpack-recipe" itemscope itemtype="https://schema.org/Recipe">
<h3 class="jetpack-recipe-title" itemprop="name">Skillet Pierogi with Mushrooms</h3>
<ul class="jetpack-recipe-meta"><li class="jetpack-recipe-servings" itemprop="recipeYield"><strong>Servings: </strong>4</li>
<li class="jetpack-recipe-time"><time itemprop="totalTime" datetime="P0DT0H20M0S"><strong>Time: </strong>20 minutes</time></li></ul>
<div class="jetpack-recipe-ingredients"><ul>
<li class="jetpack-recipe-ingredient" itemprop="recipeIngredient">2 tablespoons butter</li>
<li class="jetpack-recipe-ingredient" itemprop="recipeIngredient">1 large onion, halved and thinly sliced</li>
<li class="jetpack-recipe-ingredient" itemprop="recipeIngredient">8 ounces sliced mushrooms</li>
<li class="jetpack-recipe-ingredient" itemprop="recipeIngredient">1 1-pound bag frozen potato pierogi</li>
<li class="jetpack-recipe-ingredient" itemprop="recipeIngredient">Sour cream and chopped herbs, to serve</li>
</ul></div><div class="jetpack-recipe-directions" itemprop="recipeInstructions">SECRET METHOD</div></div>`;

test('microdata: Smitten Kitchen (Jetpack) with og:image photo', () => {
  const r = extractRecipe(JETPACK_PAGE, 'https://smittenkitchen.com/2026/10/skillet-pierogi-with-mushrooms/', { format: 'microdata' });
  assert.equal(r.n, 'Skillet Pierogi with Mushrooms');
  assert.equal(r.t, 20);
  assert.equal(r.y, 'Servings: 4');
  assert.equal(r.img, 'https://i0.wp.com/smittenkitchen.com/pierogi.jpg');
  assert.deepEqual(r.i, ['butter', 'onion', 'sliced mushrooms', 'frozen potato pierogi', 'sour cream and chopped herbs']);
  assert.ok(!JSON.stringify(r).includes('SECRET'));
});

test('ingredient names', () => {
  const cases = {
    '2 cups (480ml) chicken stock': 'chicken stock',
    '½ teaspoon kosher salt': 'kosher salt',
    '1 to 2 tbsp. gochugaru (Korean red pepper flakes)': 'gochugaru',
    'A handful of Thai basil leaves': 'thai basil leaves',
    '3 large eggs, beaten': 'eggs',
    '1 lb. boneless chicken thighs': 'boneless chicken thighs',
    '1 (13.5-ounce) can coconut milk': 'coconut milk',
    'Pinch of sugar': 'sugar',
    '2 heads baby bok choy': 'baby bok choy',
    '100g (3.5 oz) dried rice noodles': 'dried rice noodles',
    '4 cloves garlic': 'garlic',
    'For the marinade:': null,
    '2 tablespoons all-purpose flour': 'all-purpose flour',
    'An apple, diced': 'apple',
    '1 tablespoon peanut or canola oil )': 'peanut or canola oil',
    '1 large or 2 small shallots': 'shallots',
    '3 thin slices galangal': 'galangal',
    'Squeeze of lime juice': 'lime juice',
    'Serving suggestion: sticky rice and BBQ chicken!': null,
    '1 cup fine, fresh breadcrumbs': 'fine, fresh breadcrumbs',
    '4 cups beef, chicken or vegetable broth': 'beef, chicken or vegetable broth',
    '2 cloves garlic, minced': 'garlic',
    '1 onion, finely chopped': 'onion',
    'Eggs, at room temperature': 'eggs',
    '': null,
  };
  for (const [line, want] of Object.entries(cases)) assert.equal(ingredientName(line), want, line);
});

test('minutes from durations and text', () => {
  assert.equal(toMinutes('PT1H30M'), 90);
  assert.equal(toMinutes('P0DT0H45M0S'), 45);
  assert.equal(toMinutes('PT0S'), null);
  assert.equal(toMinutes('1 hour 15 minutes'), 75);
  assert.equal(toMinutes('40'), 40);
  assert.equal(toMinutes(''), null);
});

test('YouTube: public videos only, short descriptions', () => {
  const long = 'Ingredients: '.padEnd(600, 'word ');
  const v = toVideo({ snippet: { title: 'Braised Kabocha', publishedAt: '2026-10-30T15:00:00Z', description: long, resourceId: { videoId: 'abc' }, thumbnails: { medium: { url: 'https://i.ytimg.com/vi/abc/mqdefault.jpg' } } }, status: { privacyStatus: 'public' } });
  assert.equal(v.id, 'abc');
  assert.equal(v.p, '2026-10-30');
  assert.ok(v.d.length <= 281);
  assert.equal(toVideo({ snippet: { title: 'Private video', resourceId: { videoId: 'x' } } }), null);
  assert.equal(toVideo({ snippet: { title: 'x', resourceId: { videoId: 'y' } }, status: { privacyStatus: 'unlisted' } }), null);
});

test('YouTube: Shorts are marked from the channel\'s Shorts playlist', async () => {
  const item = (id, title) => ({ snippet: { title, publishedAt: '2026-11-01T00:00:00Z', resourceId: { videoId: id } }, status: { privacyStatus: 'public' } });
  const fake = async (url) => {
    const json = (body, status = 200) => ({ ok: status === 200, status, json: async () => body, text: async () => JSON.stringify(body) });
    if (url.includes('/channels?')) return json({ items: [{ contentDetails: { relatedPlaylists: { uploads: 'UUabc' } } }] });
    if (url.includes('playlistId=UUSHabc')) return json({ items: [{ contentDetails: { videoId: 's1' } }] });
    if (url.includes('playlistId=UUabc')) return json({ items: [item('v1', 'Pork Chops'), item('s1', 'Quick tip #shorts')] });
    return json({}, 404);
  };
  const vids = await fetchChannelVideos('https://www.youtube.com/@test', 'k', { fetchImpl: fake });
  assert.equal(vids.find((v) => v.id === 's1').sh, 1);
  assert.equal(vids.find((v) => v.id === 'v1').sh, undefined);
});

test('YouTube: video length from ISO 8601', () => {
  assert.equal(seconds('PT59S'), 59);
  assert.equal(seconds('PT1M5S'), 65);
  assert.equal(seconds('PT1H2M'), 3720);
  assert.equal(seconds('P0D'), 0);
});

test('popularity: sums each recipe\'s opens and skips events without a recipe', () => {
  const data = { series: [[1, 2, 0], [0, 0, 5], [3]], seriesLabels: [[0, 'woks:/mapo-tofu/'], [0, 'htk:/green-curry/'], [0, '(none)']] };
  assert.deepEqual(totals(data), { 'woks:/mapo-tofu/': 3, 'htk:/green-curry/': 5 });
  assert.deepEqual(totals({ series: [[2]], seriesLabels: ['sk:/scones/'] }), { 'sk:/scones/': 2 });
});

test('sources: KitchenCatalog entries become crawl jobs, channels, link-outs and support', () => {
  const collect = (status) => ({ status, reason: `${status} because`, checked: '2026-11-09' });
  const crawl = { sitemap: '/sitemap.xml', format: 'json-ld', size: 'about 10 posts', notes: ['sitemap: a note'] };
  const support = { links: [{ label: 'YouTube', url: 'https://www.youtube.com/@x' }], books: [] };
  const out = adapt([
    { id: 'a', name: 'A', url: 'https://a.example', kind: 'site', collect: collect('crawl'), crawl: { ...crawl, delay_seconds: 12 }, youtube: { id: 'a-yt', url: 'https://www.youtube.com/@a' }, support },
    { id: 'b', name: 'B', url: 'https://b.example', kind: 'site', collect: collect('paused'), crawl, youtube: { id: 'b-yt', url: 'https://www.youtube.com/@b' } },
    { id: 'c', name: 'C', url: 'https://www.youtube.com/@c', kind: 'channel', collect: collect('youtube-only'), search: 'https://www.youtube.com/@c/search?query={q}', search_label: 'All of C', search_note: 'backstop', support },
    { id: 'd', name: 'D', url: 'https://d.example', kind: 'site', collect: collect('link-only'), search: 'https://d.example/?s={q}', youtube: { id: 'd-yt', url: 'https://www.youtube.com/@d' }, support },
  ]);
  assert.deepEqual(out.recipes, [
    { id: 'a', name: 'A', site: 'https://a.example', sitemap: '/sitemap.xml', format: 'json-ld', delay_seconds: 12 },
    { id: 'b', name: 'B', site: 'https://b.example', sitemap: '/sitemap.xml', format: 'json-ld', paused: 'paused because' },
  ]);
  // A channel belongs to its site only when the site is crawled or paused; otherwise it stands alone.
  assert.deepEqual(out.videos, [
    { id: 'a-yt', name: 'A', site: 'a', channel: 'https://www.youtube.com/@a' },
    { id: 'b-yt', name: 'B', site: 'b', channel: 'https://www.youtube.com/@b' },
    { id: 'c', name: 'C', channel: 'https://www.youtube.com/@c' },
    { id: 'd-yt', name: 'D', channel: 'https://www.youtube.com/@d' },
  ]);
  // Sites' own searches first, YouTube searches last.
  assert.deepEqual(out.link_only.map((l) => l.name), ['D', 'All of C']);
  assert.equal(out.link_only[1].reason, 'backstop');
  // Support is keyed by creator: the site, or the channel when it stands alone.
  assert.deepEqual(Object.keys(out.support), ['a', 'c', 'd-yt']);
});

test('sources: the vendored list is valid and only vetted sources are used', () => {
  const s = readSources();
  assert.ok(s.recipes.length > 0 && s.videos.length > 0);
  assert.ok(s.recipes.some((r) => r.id === 'woks'));
  const ids = [...s.recipes.map((r) => r.id), ...s.videos.map((v) => v.id)];
  assert.equal(new Set(ids).size, ids.length);
});

// ---- Newsletters read through their RSS feed (made-up posts in Substack's markup)

import { parseFeed } from '../lib/feed.mjs';
import { recipeFromPost, amountLine, toLines } from '../lib/post.mjs';

const item = (title, slug, body, extra = '') => `<item><title><![CDATA[${title}]]></title>
<link>https://lina.substack.com/p/${slug}?utm_source=rss</link><guid isPermaLink="false">https://lina.substack.com/p/${slug}</guid>
<pubDate>Sun, 08 Nov 2026 09:00:00 GMT</pubDate>${extra}<content:encoded><![CDATA[${body}]]></content:encoded></item>`;
const li = (lines) => `<ul>${lines.map((l) => `<li><p>${l}</p></li>`).join('')}</ul>`;
const p = (lines) => lines.map((l) => `<p>${l}</p>`).join('');

const ESSAY_WITH_RECIPE = p(['My grandmother never wrote anything down, and for 3 years I tried to cook from memory.', 'Things she did with plums:']) +
  li(['eat them warm from the tree', 'dry them on the roof', 'trade them with the neighbours']) +
  '<h3><strong>Plum and walnut cake</strong></h3>' + p(['Prăjitură cu prune', '<strong>Ingredients</strong>', 'Makes 12 slices', 'Prep time: 20 minutes. Baking time: 45 minutes',
    '150g salted butter, soft', '125 g caster sugar', '3 medium size eggs', '200g plain flour', '1 tsp baking powder', '<strong>For the top:</strong>', '500 g plums, halved', 'Icing sugar',
    '<strong>Method:</strong>', 'Cream the butter with the sugar until SECRET pale.', 'Fold in the flour and bake for 45 minutes.']) +
  '<div class="subscription-widget-wrap-editor"><p>Thanks for reading! Subscribe for free to receive new posts.</p></div>';
const LIST_RECIPE = p(['It turns sweet in a hot oven.', 'Serves 4 to 6']) + li(['1 pointed cabbage', '3 tablespoons olive oil, plus more to finish', '3 teaspoons Dijon mustard', '1 generous pinch fine sea salt', '¼ cup/60 ml grated Parmigiano']) +
  p(['Preheat the oven to 220°C.', 'Cut the cabbage into 8 wedges.', 'Roast for 30 minutes.']);
const TWO_RECIPES = '<p><strong>First recipe: Easter bread</strong></p>' + p(['500g bread flour', '80g caster sugar', '7g yeast', '2 egg yolks', '<strong>Method:</strong>', 'Mix everything and wait.']) +
  '<h4>RECIPE. Torta di ricotta. Sweet cheese pie</h4>' + p(['Ingredients:', '400g ricotta', '100g sugar', '2 eggs', '1 lemon, zested', '<strong>Method:</strong>', 'Whisk and bake.']);
const TRAVEL = '<h2>Our 2027 cooking classes</h2>' + p(['3 days in Lucca, with 12 guests at the table.', 'The new dates are 1st-8th September 2027.', '2 rooms are left for the autumn week.', '40 glasses of wine later, we went home.']) +
  li(['12 September: market tour', '14 September: pasta day', '16 September: farewell lunch']) + '<p><strong>What I am reading</strong></p>' + p(['5 books, 2 podcasts and 1 very long article.']);
const PAYWALLED = p(['This soup is all I want in July.', 'You’ll find the recipe below for paid subscribers.']) + '<p><a href="https://lina.substack.com/p/zucchini-soup">Read more</a></p>';
const PANTRY_TALK = '<h3>Introductions and the pantry</h3>' + p(['Lina: What is always in your pantry?', 'Flour, sugar, 2 kinds of paprika and far too many jars.', 'Ingredients matter more than recipes, she says.']);

const FEED = `<?xml version="1.0" encoding="UTF-8"?><rss xmlns:content="http://purl.org/rss/1.0/modules/content/" version="2.0"><channel><title><![CDATA[Lina's table]]></title><link>https://lina.substack.com</link>
${item('The plum tree behind the house', 'plum-tree', ESSAY_WITH_RECIPE, '<enclosure url="https://substackcdn.com/image/fetch/f_auto/https%3A%2F%2Fexample.com%2Fplums.jpeg" length="0" type="image/jpeg"/>')}
${item('Roasted pointed cabbage', 'cabbage', LIST_RECIPE)}
${item('Two things for Easter', 'easter', TWO_RECIPES)}
${item('Come and cook with us', 'classes', TRAVEL)}
${item('Zucchini soup', 'zucchini-soup', PAYWALLED)}
${item('A pantry between two countries', 'pantry', PANTRY_TALK, '<enclosure url="https://api.substack.com/feed/podcast/1.mp3" length="0" type="audio/mpeg"/>')}
</channel></rss>`;

test('feed: posts with clean links, dates and cover photos', () => {
  const posts = parseFeed(FEED);
  assert.equal(posts.length, 6);
  assert.equal(posts[0].link, 'https://lina.substack.com/p/plum-tree');
  assert.equal(posts[0].date, '2026-11-08');
  assert.equal(posts[0].image, 'https://substackcdn.com/image/fetch/f_auto/https%3A%2F%2Fexample.com%2Fplums.jpeg');
  assert.equal(posts[5].image, null); // a podcast's audio file is not a photo
  assert.throws(() => parseFeed('<html>Sign in</html>'));
});

test('feed: only posts that hold a recipe are kept', () => {
  const kept = Object.fromEntries(parseFeed(FEED).map((post) => [post.title, recipeFromPost(post, { defaultCuisine: 'Romanian' })]));
  assert.deepEqual(Object.keys(kept).filter((k) => kept[k]), ['The plum tree behind the house', 'Roasted pointed cabbage', 'Two things for Easter']);
});

test('feed: a recipe inside an essay gets the dish name, names only, no method', () => {
  const r = recipeFromPost(parseFeed(FEED)[0], { defaultCuisine: 'Romanian' });
  assert.equal(r.n, 'Plum and walnut cake');
  assert.deepEqual(r.kw, ['The plum tree behind the house']);
  assert.equal(r.y, 'Makes 12 slices');
  assert.equal(r.t, 65);
  assert.equal(r.c, 'Romanian');
  assert.deepEqual(r.i, ['salted butter', 'caster sugar', 'eggs', 'plain flour', 'baking powder', 'plums', 'icing sugar']);
  assert.ok(!JSON.stringify(r).includes('SECRET') && !JSON.stringify(r).includes('150'));
  assert.deepEqual(Object.keys(r).sort(), ['c', 'i', 'img', 'kw', 'n', 't', 'u', 'y']);
});

test('feed: a bare list after "Serves 4"; two recipes in one post', () => {
  const [, cabbage, easter] = parseFeed(FEED);
  const a = recipeFromPost(cabbage);
  assert.equal(a.n, 'Roasted pointed cabbage');
  assert.equal(a.y, 'Serves 4 to 6');
  assert.deepEqual(a.i, ['pointed cabbage', 'olive oil', 'dijon mustard', 'fine sea salt', 'grated parmigiano']);
  const b = recipeFromPost(easter);
  assert.equal(b.n, 'Two things for Easter');
  assert.deepEqual(b.kw, ['Easter bread', 'Torta di ricotta. Sweet cheese pie']);
  assert.deepEqual(b.i, ['bread flour', 'caster sugar', 'yeast', 'egg yolks', 'ricotta', 'sugar', 'eggs', 'lemon']);
});

test('feed: amounts versus ordinary numbers', () => {
  const cases = { '150g butter': 2, '2tsp cornflour, optional': 2, '2x tin of tomatoes': 2, '4 egg whites': 1, 'Half of the lemon juice': 1, '1. Heat the oil': 0, '3 days in Lucca': 0, '2027 dates are open': 0, '1st-8th September': 0, '12 guests at the table': 0, 'Two sausages, one region. Two stories.': 0, 'Salt': 0 };
  for (const [line, want] of Object.entries(cases)) assert.equal(amountLine(line), want, line);
  assert.deepEqual(toLines('<p><strong>For the glaze</strong> 40 g butter<br>2 tbsp honey</p>').map((l) => l.text), ['For the glaze', '40 g butter', '2 tbsp honey']);
});

test('sources: a source with a feed is read from its feed', () => {
  const collect = { status: 'crawl', reason: 'r', checked: '2026-11-11' };
  const out = adapt([{ id: 'lina', name: "Lina's table", url: 'https://lina.substack.com/about', kind: 'site', collect, feed: { url: '/feed', default_cuisine: 'Romanian' } }]);
  assert.deepEqual(out.recipes, [{ id: 'lina', name: "Lina's table", site: 'https://lina.substack.com', feed: '/feed', default_cuisine: 'Romanian' }]);
});
