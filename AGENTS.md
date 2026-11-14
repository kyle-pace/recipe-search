<!-- BEGIN principles (web): synced from github.com/kyle-pace/principles. Edit them there; changes made here are overwritten. -->

## Development principles

These apply to every project Kyle builds, on any platform, with any agent. The project's own section of this file adds specifics and can override a default for that project. Kyle's direct instructions in a session override both.

### Priority order

When two goals conflict, the higher one wins:

1. Accessibility
2. Privacy
3. Correctness and reliability
4. Performance
5. Polish

### Accessibility comes first

Accessibility is designed in from the first commit, not audited in at the end.

- Meet WCAG 2.2 AA at minimum. Text contrast is at least 4.5:1 (3:1 for large text and for UI parts like borders and icons), in both light and dark mode.
- Use semantic, native elements first (`button`, `a`, `label`, headings in order, landmarks). Add ARIA only when no native element does the job.
- Everything interactive works with a keyboard, has a visible focus style and has an accessible name. Touch targets are at least 24×24 px; aim for 44×44.
- Never carry meaning with color alone. Meaningful images get alt text; decorative ones get empty alt.
- Respect user settings: reduced motion, light/dark preference, text zoom to 200% without breaking layout.
- Motion is short (under 300 ms for interface animation) and never `ease-in`.
- On the web, motion only runs inside `@media (prefers-reduced-motion: no-preference)`.

### Every screen size from day one

Layouts are designed for phones, tablets and big screens from the first commit, not stretched or squeezed in later.

- **Web projects** are fully responsive: mobile first, fluid from 320 px wide up to large desktop monitors. No sideways scrolling at 320 px. Cap line length for reading (about 70 characters), and let wider screens add columns instead of stretching text.
- Prefer fluid layouts (flexbox, grid, `clamp()`, container queries) over many fixed breakpoints.
- Handle touch, mouse and keyboard on every size, and respect safe areas and notches.

### Type

- Atkinson Hyperlegible Next for all text and Atkinson Hyperlegible Mono for code, in every product.
- Self-host the fonts. Never load them from Google Fonts or any other font CDN.
- On the web, use the `@fontsource/atkinson-hyperlegible-next` and `@fontsource/atkinson-hyperlegible-mono` packages.
- Offering a setting to switch to the device's own font is fine.

### Privacy comes second, and right behind

- Collect the least data that answers a real product question. No ad or marketing pixels, no fingerprinting, no selling or sharing data.
- Never put personal information in analytics: no names, emails, free-text input or precise location.
- Respect Global Privacy Control and Do Not Track by sending no analytics at all, and give people an opt-out.
- No cookies for analytics (keep the ID in `localStorage`), so no cookie banner is needed.
- Analytics only runs on the live production domain, never on localhost or preview builds.
- Any project that collects data has a short, plain-language privacy page.
- Secrets never go in Git. (Browser API keys that are public by design, like Amplitude's, are fine in code.)

### Default stack

Use these unless the project's section says otherwise. **Do not add any other third-party service, SDK, script, font or paid tool without asking Kyle first.**

- **Product analytics: Amplitude**, set up the private way:
  - on the web, use `startAnalytics` from kp-design's `kp-design/analytics`, which does all of this
  - autocapture on, IP address tracking off, identity in `localStorage`
  - off under GPC, Do Not Track or the opt-out; only on the live domain
  - Session Replay only if the project wants it: a small sample (about 5%), conservative masking, and its code only loaded for sampled sessions
  - custom events follow the naming rules under "Analytics events" below
- **Backend: Firebase** (Auth, Firestore, Functions, Storage) when a project needs accounts or shared data.
  - Security rules deny by default and are locked down before anything ships.
  - Firebase Analytics stays off; Amplitude covers analytics.
- **Web hosting: Cloudflare** (Workers with static assets). GitHub Pages is fine for a simple static site.
- **Design system for Kyle's websites: [kp-design](https://github.com/kyle-pace/kp-design)**, installed from GitHub and pinned to a commit. It holds the tokens, self-hosted Atkinson, header, footer, display settings and analytics; projects on kylepace.dev use its `DevLayout`. Don't copy these into a project; change them in kp-design. (Apple apps don't use it.)
- Put each outside service behind its own module (one file talks to Amplitude, one to Firebase), so switching tools means changing one file.
- CI checks the stack on every push: Amplitude is in every site and app, Firebase Analytics isn't, each Firebase config file is for a bundle ID the app really has, and Firestore rules aren't open. It can't see inside the Amplitude or Firebase consoles, so settings there (APNs keys, API key restrictions, a separate production project) still need a person.
- Keep running costs near zero: prefer static pages, free tiers and on-device work, and ask before adding anything that bills.

### Analytics events

Every project uses the same rules, so charts read the same way everywhere.

- **Event names:** Title Case, past-tense verb first, then the object: "Saved Recipe", "Viewed Deal", "Completed Onboarding". Not "Recipe Saved" and not `save_recipe`. Use the same verb for the same action across projects (Viewed, Opened, Tapped, Added, Removed, Changed, Saved, Completed).
- **Property names:** lowercase `snake_case` (`deal_id`, `stores_picked`). Keep names and values the same across events and projects when they mean the same thing.
- Leave Amplitude's own `[Amplitude] …` events alone. Add custom events only for actions that answer a real product question; autocapture covers page views and clicks.
- **One Amplitude project per product.**
- kylepace.dev and every experiment on it share the kylepace.dev project, so each experiment's custom events also send `experiment` with the project's slug (`experiment: "skill-tree"`).
- **Tracking plan first:** add each new event to the project's tracking plan in Amplitude, with a description and category, when it ships. Nothing should arrive as "unexpected".
- **Renaming an event:** rename it in code, then merge the old name into the new one in Amplitude so history stays connected. Don't rename in Amplitude alone.
- **New product:** create its Amplitude project and add a row for it to the "All projects overview" dashboard. A new experiment on kylepace.dev needs neither: it appears there by page path.

### Self-host everything; approve outside hosts one at a time

- Serve libraries, fonts and assets from the project itself. Install them from npm and bundle them, or keep a pinned copy in the repo (for example in `vendor/`) with a script that refreshes it.
- Never load them from a CDN like jsDelivr, unpkg or cdnjs.
- **Scripts, styles, fonts and APIs** from an outside host need Kyle's OK every time. Approvals are per project and per host. Once he approves, add the host to that project's `.agents/allowed-hosts.txt` with a comment saying what it's for and the date he approved it.
- **Images** are lighter, because an outside image can only learn that someone visited, not run code. An image host can be added without asking when the image belongs to the content being shown (a recipe site's own photo on a result for its recipe, a book's cover from the library that lists it). Load those images with `referrerpolicy="no-referrer"` and `loading="lazy"`, add the host to `.agents/allowed-hosts.txt` with a comment saying what it's for, and mention the new host to Kyle when you report back. Decorative images, stock photos and anything that looks like tracking still need his OK.
- All of this applies to hosts that JavaScript calls at runtime too, even though the CI check only sees HTML and CSS. List those in the same file.

### Look and feel: no generated defaults

- Before building a page or app's look, write a short plan in `design/PLAN.md`: the subject and who it's for, the one bold element, 4 to 6 named colors (light and dark), and the layout as a sketch. Take the ideas from the subject's own world, not from other websites. If a frontend-design skill is available, load it.
- Check the plan against the generated defaults and change anything that matches: a big headline over a muted sentence and a pill button; pills or one corner radius on everything; grids of identical cards; small labels above headings; colored dots or squares as decoration; details joined with middle dots; monospace for small labels; copy that explains the interface instead of using it.
- Spend boldness in one place and keep the rest quiet. Look at screenshots (phone and desktop, light and dark) before calling it done.
- Experiments on kylepace.dev are their own pages (kp-design's `LabLayout`) with their own look. The app comes first; the explanation goes in an About section linked from the top bar.

### How things get built

- Static and simple by default. Add JavaScript, servers or dependencies only where they earn it.
- Colors, type and spacing live in one tokens file. Light and dark mode exist from the start.
- Copy is plain language, written for the person using it.
- Don't add "Built with AI" lines or other AI credits to sites or apps unless Kyle asks.

### Correctness

- Anything that reads data from outside the project (a feed, a flyer, an API response, a file someone picks) gets a test that runs it against a saved real sample, plus one broken sample.
- One bad record never takes down the rest: skip it, log it, and keep going.
- A scheduled job that fails must fail out loud (a red run), and must never replace good published data with empty or partial data.
- A bug fix comes with a test that fails without the fix, when the project has tests.

### Performance

Budgets, not goals. If a project needs to go over (a map, a globe, a video player), its section says so and by how much.

- Content pages ship no more than 50 KB of JavaScript (compressed), and read fine without it.
- No single image over 200 KB. Images are sized to how they're shown, served as AVIF or WebP, given `width` and `height`, and lazy-loaded below the first screen.
- On a mid-range phone: the main content shows within 2.5 seconds (Largest Contentful Paint) and the layout shifts less than 0.1 (Cumulative Layout Shift). Lighthouse performance is 90 or higher on mobile.

### Shipping

- Small commits, each with a plain sentence saying what changed for the person using it.
- Websites deploy from `main`. Once the checks for the change's tier pass (see "Before you call it done"), push to `main`; no need to wait for Kyle. Use a branch and pull request when he asks for one, or when you want him to look before it goes live.
- Never force-push `main`, skip a failing check to get something out, or commit a secret.
- Changing the principles or kp-design changes every project. Test the change against one real project first, then roll it out.
- **Ask Kyle first, every time:** anything that costs money; a new outside service, SDK or host (see above); DNS, domain or email changes; deleting data, a repo or a deployed project; making a private repo public or a public one private; publishing something he hasn't linked publicly yet (a draft, a case study, an unannounced app); anything that speaks for him (his résumé, LinkedIn, a post or message in his name).
- When Kyle has to do a step himself (approve a setting, create a repo, sign in), give him the direct link to the exact page.
- If you couldn't finish or couldn't check something, say so plainly in your report. Don't describe work as done when a step was skipped.

### Teach Kyle as you go

Kyle is a product leader building his development skills through this work. Treat each session as a chance to teach, briefly.

- When a change involves a real decision (data structure, architecture, a library, security, performance, a tradeoff), explain it in plain language: what you chose, the main alternative, and why. A short paragraph, not a lecture.
- After making changes, show the most important part of the diff and walk through what it does in plain terms. Point out one thing worth learning from it.
- Define jargon the first time it comes up in a session.
- When a change is small and safe (a color, copy, a value, spacing), offer to let Kyle make it by hand, and tell him which file and line to change.
- Skip all of this for trivial changes like typos and formatting.

### Every new page or project ships with

- A share card (Open Graph image, 1200×630) in dark mode, using Atkinson. Follow `.agents/skills/share-card/SKILL.md`.
- A real title, description and favicon.
- A privacy note if it collects anything.

### Before you call it done

Match the checking to the change. If you're unsure which tier a change is, use the higher one. In your report, say which tier you used and what you ran.

**Tier 1: words and data.** Copy, a link, a value in a data file, a dependency pin, docs.

- The build passes, and so do any tests and linters.
- Read the changed text where it shows up in the built output.

**Tier 2: something people see or use changed.** Layout, styles, a component, a new control, new behavior.

- Everything in tier 1.
- Run the project's check command (`npm run check` where a project has one). It runs axe on every page in light and dark, fails on sideways scrolling, and saves screenshots at 320, 768, 1280 and 1920 px. Fix what it finds.
- Look at the changed screen in light and dark, at the smallest size and a large one.
- Use new controls with the keyboard (and VoiceOver in apps): reachable, visible focus, a name that makes sense.

**Tier 3: a new page, screen or project, or a redesign.**

- Everything in tier 2.
- Look at every size in light and dark: 320, 768, 1280 and 1920 px wide.
- Check it at 200% text zoom (the largest Dynamic Type size in apps) and with reduced motion on.
- Everything under "Every new page or project ships with".
- Check it against the performance budgets.

CI runs the check command where a project has one, the stack check (see "Default stack"), and a third-party check that fails if a page loads scripts, styles, fonts or images from a host that isn't allowed. Don't add a host just to get past it: ask Kyle, or for a content image follow the image rule above.

<!-- END principles -->

## This project: Recipe search

Working name. One search box across the recipe sites Kyle trusts, from our own small index instead of Google. Part of the App Projects family with Seattle Grocery Deals and Maitake.

- **Plan and decisions** live in Confluence: App Projects space (APPS), page "Recipe search" (6848557) and its child pages. Keep it current when anything here changes.
- **Docs mirror** in the claude.ai App Development project: `recipe-search/overview.md`.

### Rules for collecting data

- Respect every site's robots.txt and terms. Check robots.txt on every run, and skip a site that starts blocking us.
- Keep only what's needed to find a recipe: title, link, photo link, ingredient names, total time, cuisine, course, yield. Never the method, headnotes, comments or ratings text. Every result links to the original.
- Crawl slowly: one request at a time per site, a few seconds apart. Identify the crawler by name with a contact page.
- Read sitemaps and fetch only pages that are new or changed.
- Newsletters (Substack and other sites with an RSS feed but no recipe data) are read only through their public RSS feed: one request per run, never the post pages, never an archive or private API, never anything behind a paywall. A post is kept only when it holds a recipe (`crawler/lib/post.mjs` decides), and what's kept is the same short list as for a site. Kyle's decision (2026-11-11): Substack's terms bar crawling and scraping, and reading only the feed it publishes for feed readers while keeping this little is the line we hold; writers aren't messaged first for now. The About page promises removal within a week to anyone who asks, so honor it: set the source to `link-only` or take it out. The full note is in KitchenCatalog's `recipe-sources/schema.md` under `feed`. Each newsletter still has to be one Kyle picked.
- YouTube only through the official YouTube Data API. Refresh stored video data at least every 30 days (the weekly run does), drop removed or private videos, and label video results clearly as YouTube.
- The YouTube key lives in the GitHub Actions secret `YOUTUBE_API_KEY`. Never in code, the site, or a chat.
- Adding a source means checking robots.txt, terms and whether it publishes recipe data first, and recording the result in KitchenCatalog's `recipe-sources/sources.json` and Confluence. To add or change a source, edit that file in kyle-pace/kitchen-catalog (`node js/test.mjs` checks it), push it, then run `npm run sync-catalog` here and commit the copy. Only `vetted: true` sources are used.
- Serious Eats is not crawled (its owner requires written permission). It's a link-out only, unless permission is given.

### Shared App Projects rules

- Free to run, private by default, no accounts.
- Type is Atkinson Hyperlegible Next (and Mono for code). The display settings panel (theme, text size, font) is on every page.
- Text meets WCAG 2.2 AA contrast. Interface motion under 300 ms, custom easing, only under `prefers-reduced-motion: no-preference`.
- Ingredient names come from KitchenCatalog (kyle-pace/kitchen-catalog, which has a JS matcher), so ids match Grocery Deals and Maitake.
- Pantry data never comes to this site. "Use what I have" in the app belongs in Maitake, reading this site's static index; on the web it's typed in.

### Layout

- Sources: every source, how it's collected, the result of its last check and ways to support its creator live in KitchenCatalog (`recipe-sources/sources.json`, field reference in `recipe-sources/schema.md`), vendored to `vendor/kitchen-catalog/sources.json`. `crawler/lib/sources.mjs` turns it into the crawl jobs, YouTube channels, link-outs and support links the crawler and `scripts/build-index.mjs` use.
- `crawler/`: the weekly crawl (`node crawler/crawl.mjs`, options at the top of the file). `npm test` runs its tests. GitHub Actions runs it every Monday (`.github/workflows/crawl.yml`) and commits the results; run it by hand from the Actions tab with a small `limit` to test.
- Feed sources: a source with a `feed` section (instead of `crawl`) is read by `crawlFeed` in `crawler/crawl.mjs`. `crawler/lib/feed.mjs` reads the RSS; `crawler/lib/post.mjs` keeps a post only if it has a run of ingredient lines with amounts plus a sign it's a recipe (an Ingredients or Method label, a "Serves 4" line, or steps starting with cooking verbs). The dish's own heading becomes the name and the post's title a keyword. A feed lists only the newest posts (about 20), so recipes stay after their post leaves the feed, and there is no back catalogue. To switch a newsletter on: in KitchenCatalog set it `vetted: true` with its home as `url`, `collect.status: crawl` and `"feed": { "url": "/feed", "default_cuisine": "…" }`, sync, and add its photo host (`substackcdn.com` for Substack) to `.agents/allowed-hosts.txt`.
- `data/<id>.json`: what we keep per recipe (n name, u link, t minutes, c cuisine, k course, y yield, i ingredient names, img photo link, kw keywords) or per video. `data/status.json`: the last run's counts and alerts.
- `state/<id>.json`: every page seen, its sitemap lastmod, whether it had a recipe and when it was fetched, so only new or changed pages are fetched.
- `prototype/`: the November 1, 2026 prototype. `python3 prototype/build.py` writes `prototype/index.html` from `template.html` and the sample data in `prototype/data/`. Published as a private Claude artifact; see Confluence for the link.

### The search page

- Live at [kylepace.dev/recipe-search/](https://kylepace.dev/recipe-search/), one of the experiments on the [kylepace.dev](https://github.com/kyle-pace/kylepace.dev) hub. It's its own Cloudflare Worker (`recipe-search`); the routes in `wrangler.jsonc` claim `kylepace.dev/recipe-search` and `/recipe-search/*`. Cloudflare Workers Builds deploys `main` (build `npm run build`, deploy `npx wrangler deploy`), so every weekly crawl that lands on `main` ships a fresh index.
- Everything the site serves sits under `/recipe-search/`: the page is `src/pages/recipe-search/index.astro`, its script is `src/scripts/search.ts`, public files go in `public/recipe-search/`, built assets go to `/recipe-search/_astro/`. Don't use Astro's `base` option; with the Cloudflare adapter it serves files from the wrong folder.
- `scripts/build-index.mjs` turns `data/` into `public/recipe-search/index.json` (generated, not committed) before every build. It matches ingredient lines with the vendored KitchenCatalog in `vendor/kitchen-catalog/`; refresh that copy with `npm run sync-catalog` (expects a clone at `../kitchen-catalog`). `node scripts/build-index.mjs --report` lists the most common lines the catalog doesn't know yet, which belong in KitchenCatalog, not here.
- The look comes from `design/PLAN.md`: one search box, centered on the home page like a search engine's, moving up once you search. Words are searched as words; ingredients and creators picked from the suggestions become tags in the box. Read the plan before changing the page, and don't drift back to template defaults: no pills, eyebrow labels, card grids or middle-dot meta lines.
- The search page is only the app. The explanation is its own page, `src/pages/recipe-search/about.astro` (`/recipe-search/about/`), built at build time from the index and linked from the top bar (`src/components/LabLinks.astro`). Old `#about` links forward there. The crawler's user agent links to it, so keep its "For site owners" section accurate.
- Creators: a creator is a site, a site and its YouTube channel, or a channel alone (Kenji). The `site=` URL parameter holds creator ids.
- It stands on its own, not as a page of kylepace.dev: the shell is kp-design's `LabLayout` (a back link to kylepace.dev, a footer line, display settings, analytics), pinned to a commit in package.json. Its look is its own: `src/styles/theme.css` overrides the tokens.
- Photos load straight from each recipe's own site (Kyle's call, 2026-11-08), with no referrer and lazily. Their hosts are in `.agents/allowed-hosts.txt`. A site that blocks it or asks us to stop gets text-only cards: set `crawl.photos: false` on it in KitchenCatalog's `recipe-sources/sources.json`, then `npm run sync-catalog`.
- The share cards are `design/og.html` and `design/og-about.html`, rendered to `public/recipe-search/og.png` and `og-about.png`.
- Run `npm run build` before pushing; it must pass.

### The MCP endpoint

- `kylepace.dev/recipe-search/mcp` lets AI assistants search the index over MCP (Streamable HTTP), added 2026-11-11. Two read-only tools, `search_recipes` and `list_sources`. No sign-in, no analytics, and it never logs what was asked.
- It's an Astro endpoint (`src/pages/recipe-search/mcp.ts`, `prerender = false`), the only part of the site that runs on the server; the pages stay static files. It reads the same `index.json` the page loads, through the Worker's `ASSETS` binding, once per isolate. Built on `createMcpHandler` from Cloudflare's Agents SDK (`agents`) with MCP SDK v2 (`@modelcontextprotocol/server`) and `zod`; stateless, no Durable Object. `nodejs_compat` in `wrangler.jsonc` is for it.
- The search rules live in `src/mcp/search.mjs` and follow the page's (`src/scripts/search.ts`), minus typo fixing. Change a ranking rule in one and check the other. If the index's shape changes in `scripts/build-index.mjs`, update `prepare()` there too.
- The collecting rules apply here as well: results are names, links, ingredient names, time and cuisine, never the method, and the server's instructions tell assistants to send people to the original. Pantry data still never comes to this site: ingredients arrive as typed words, like on the page.
- `npm test` covers the rules; `npm run try-mcp` calls every tool with the official client (against `npm run preview`, or pass the live address).
- The About page has an "Ask your AI assistant" section (`#assistants`): an Add to Claude button (a prefilled claude.ai link that Claude doesn't document, tested 2026-11-11), the address with a copy button, and what the server keeps (nothing). A browser that opens the MCP address is sent there. If the server's address changes, change `mcpAddress` in `about.astro` too.
- Seattle Grocery Deals has a sister server (`mcp/` in its repo, at mcp.seattlegrocery.deals) and stays separate on purpose (Kyle, 2026-11-11): recipes are for anyone, deals are only for Seattle. Henwood's is local, in the Mac app.
- **Checking a change:** `npm run build`, then `npm run check` (the `page-check` skill): axe in light and dark, sideways scrolling, JavaScript weight, and screenshots in `.check/`. CI runs it on every push.
