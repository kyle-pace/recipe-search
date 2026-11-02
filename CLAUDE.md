# Working on Recipe search

Working name. One search box across the recipe sites Kyle trusts, from our own small index instead of Google. Part of the App Projects family with Seattle Grocery Deals and Maitake.

- **Plan and decisions** live in Confluence: App Projects space (APPS), page "Recipe search" (6848557) and its child pages. Keep it current when anything here changes.
- **Docs mirror** in the claude.ai App Development project: `recipe-search/overview.md`.

## Rules for collecting data

- Respect every site's robots.txt and terms. Check robots.txt on every run, and skip a site that starts blocking us.
- Keep only what's needed to find a recipe: title, link, photo link, ingredient names, total time, cuisine, course, yield. Never the method, headnotes, comments or ratings text. Every result links to the original.
- Crawl slowly: one request at a time per site, a few seconds apart. Identify the crawler by name with a contact page.
- Read sitemaps and fetch only pages that are new or changed.
- YouTube only through the official YouTube Data API. Refresh stored video data at least every 30 days (the weekly run does), drop removed or private videos, and label video results clearly as YouTube.
- The YouTube key lives in the GitHub Actions secret `YOUTUBE_API_KEY`. Never in code, the site, or a chat.
- Adding a source means checking robots.txt, terms and whether it publishes recipe data first, and recording the result in `sources.yaml` and Confluence.
- Serious Eats is not crawled (its owner requires written permission). It's a link-out only, unless permission is given.

## Shared App Projects rules

- Free to run, private by default, no accounts.
- Type is Atkinson Hyperlegible Next (and Mono for code). The display settings panel (theme, text size, font) is on every page.
- Text meets WCAG 2.2 AA contrast. Interface motion under 300 ms, custom easing, only under `prefers-reduced-motion: no-preference`.
- Ingredient names come from KitchenCatalog (kyle-pace/kitchen-catalog, which has a JS matcher), so ids match Grocery Deals and Maitake.
- Pantry data never comes to this site. "Use what I have" in the app belongs in Maitake, reading this site's static index; on the web it's typed in.

## Layout

- `sources.yaml`: every source, how it's collected, and the result of its last check.
- `crawler/`: the weekly crawl (`node crawler/crawl.mjs`, options at the top of the file). `npm test` runs its tests. GitHub Actions runs it every Monday (`.github/workflows/crawl.yml`) and commits the results; run it by hand from the Actions tab with a small `limit` to test.
- `data/<id>.json`: what we keep per recipe (n name, u link, t minutes, c cuisine, k course, y yield, i ingredient names, img photo link, kw keywords) or per video. `data/status.json`: the last run's counts and alerts.
- `state/<id>.json`: every page seen, its sitemap lastmod, whether it had a recipe and when it was fetched, so only new or changed pages are fetched.
- `prototype/`: the November 1, 2026 prototype. `python3 prototype/build.py` writes `prototype/index.html` from `template.html` and the sample data in `prototype/data/`. Published as a private Claude artifact; see Confluence for the link.
