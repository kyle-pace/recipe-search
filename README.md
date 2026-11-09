# Recipe search

One search box across the recipe sites I trust: The Woks of Life, Just One Cookbook, Hot Thai Kitchen, Smitten Kitchen, Maangchi, and J. Kenji López-Alt's YouTube videos. It runs on our own small index, not Google, and every result opens on the original site.

**Status:** live at **[kylepace.dev/recipe-search](https://kylepace.dev/recipe-search/)**, one of the experiments on [kylepace.dev](https://kylepace.dev) (November 8, 2026). Working name; the real name and domain are still open.

## How it will work

1. A weekly job checks each site's robots.txt, reads its sitemap, and keeps only the data needed to find a recipe: title, link, ingredient names, time and cuisine. Never the method.
2. Kenji's videos come from the official YouTube Data API.
3. Ingredients are matched to KitchenCatalog names, so "scallions" and "green onion" find the same recipes.
4. The data becomes a static search index that runs in the browser (`scripts/build-index.mjs`, on every build). Free to host, no server, and nothing typed leaves the page.
5. Sites we can't index, like Serious Eats, get an "Also search" link instead.

See `sources.yaml` for every source and why it's in or out, and `CLAUDE.md` for the rules.

## The crawler

```sh
npm ci
npm test
node crawler/crawl.mjs --limit 5 --sources woks   # a small try
```

GitHub Actions runs the full crawl every Monday and commits `data/` and `state/`. A push that changes the crawler or `sources.yaml` runs a smoke test on the live sites instead (5 pages each, nothing committed). The first full run fills the index; later runs fetch only pages whose sitemap date changed. A run with a blocked site, a failed source or a big drop in recipe count fails, so it shows up as a GitHub notification.

## The search page

```sh
npm install
npm run dev       # http://localhost:4321/recipe-search/
npm run build     # builds the index, then the site, to dist/
npm run preview   # builds, then runs it the way Cloudflare will
```

| What | Where |
| --- | --- |
| The page | `src/pages/recipe-search/index.astro` |
| Searching, typeahead, filters, URL state | `src/scripts/search.ts` |
| The index (generated, not committed) | `public/recipe-search/index.json`, from `scripts/build-index.mjs` |
| Ingredient matching | `vendor/kitchen-catalog/` (refresh with `npm run sync-catalog`) |
| Page shell (header, footer, analytics) | `DevLayout` from [kp-design](https://github.com/kyle-pace/kp-design) |
| Share card | `design/og.html`, rendered to `public/recipe-search/og.png` |
| Outside hosts (recipe photos) | `.agents/allowed-hosts.txt` |

It's its own Cloudflare Worker, `recipe-search`, mounted on the hub's domain by two routes in `wrangler.jsonc`. Cloudflare Workers Builds deploys `main` (build `npm run build`, deploy `npx wrangler deploy`), so each Monday's crawl ships a fresh index on its own.

## The prototype

```sh
python3 prototype/build.py   # writes prototype/index.html
```

Open `prototype/index.html` in a browser. It uses a small real sample: 34 recipes and 14 videos.
