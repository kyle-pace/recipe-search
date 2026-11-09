---
name: share-card
description: Make the share card (Open Graph image) for a new page or project. Use whenever a new page, post, app or project is added, or when asked for a share card, OG image or social preview.
---

# Share card

Every new page or project gets its own share card: the image that shows when a link is shared in Messages, Slack, Mastodon, LinkedIn and so on.

## The look

- 1200×630 px PNG.
- Dark mode: a near-black background (kylepace.net uses `#141317`), light text (`#f3efe8`), muted text (`#aaa5b2`), and the project's own accent color for one or two moments.
- Atkinson Hyperlegible Next, bold for the title. Self-hosted font files, never a font CDN.
- One clear title (roughly 64 to 96 px), a short line of supporting text, and the site or app name. Keep important content at least 64 px from the edges, since some apps crop.
- Text on the card meets AA contrast against its background, the same as on a page.
- No "Built with AI" or similar credits.

## How to make it

1. Write the card as a small, standalone HTML file next to the project's other design files (kylepace.net keeps them in `design/og-*.html`). Set `body` to exactly 1200×630 with `overflow: hidden`, and load the font with `@font-face` pointing at the `@fontsource/atkinson-hyperlegible-next` files in `node_modules`. If the project has a tokens file, use its dark-theme values.
2. Render it to PNG at 1200×630 with a headless browser, for example:
   ```sh
   npx playwright screenshot --viewport-size=1200,630 "file://$PWD/design/og-example.html" public/og-example.png
   ```
   (Run `npx playwright install chromium` first if it isn't installed.)
3. Look at the PNG to check nothing is clipped and the text is readable at a small size.
4. Wire it into the page: `og:image` (absolute URL), `og:image:width` 1200, `og:image:height` 630, `og:image:alt` describing the card, and `twitter:card` set to `summary_large_image`. Use the project's existing way of setting a page's image if it has one.
5. Keep the HTML source in the repo so the card can be re-rendered when the title changes.
