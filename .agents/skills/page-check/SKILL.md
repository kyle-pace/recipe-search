---
name: page-check
description: Run or set up the check command for a web project (npm run check). It runs axe on every page in light and dark, catches sideways scrolling and oversized JavaScript, and saves screenshots at 320, 768, 1280 and 1920 px. Use for any tier 2 or tier 3 change to a website, when asked to check accessibility or take screenshots of a site, or when a web project has no check command yet.
---

# Page check

The principles ask for different checking depending on the size of a change ("Before you call it done"). This is the automated part for websites. `check.mjs` in this folder does the work; it's the same file in every project, synced from the principles repo.

## Running it

```sh
npm run build
npm run check
```

It checks every page the build wrote as an HTML file and fails on:

- any axe finding (WCAG 2.2 AA), in light or dark, at 320 or 1280 px
- a page that scrolls sideways at 320, 768, 1280 or 1920 px
- a page that ships more than 50 KB of JavaScript, compressed

It also saves full-page screenshots to `.check/`, named `<page>-<width>-<light|dark>.png`. In a full-page shot, anything fixed to the screen (the display settings button, a sticky bar) is drawn once, where the first screen ends, so it can look like it covers content in the middle of the page. It doesn't; check how it sits at the very bottom of the page instead. Passing the check is not the same as looking: open the screenshots of the pages you changed (at least the smallest width and a large one, both themes) and check nothing overlaps, clips or looks off.

Useful options: `--pages /apps/,/labs/` to check only some pages, `--no-shots` to skip screenshots, `--dir <folder>` if the build isn't in `dist/client`, `dist` or `_site`. Locally, set `CHROME=/path/to/chrome` to use a browser that's already installed.

What it can't see: pages rendered on the server at request time, anything behind a click (menus, dialogs, a map's controls), keyboard order, and whether alt text is any good. Check those by hand for the screens you changed.

## Setting it up in a project

1. `npm install --save-dev playwright axe-core`
2. Add to `package.json` scripts: `"check": "node .agents/skills/page-check/check.mjs"`
3. Add `.check/` to `.gitignore`.
4. Run it. Fix what it finds, or, if a page really needs more JavaScript than the budget (a map, a globe), say so in the project's section of `AGENTS.md` and pass `--js-budget <KB>` in the script.

If the project already uses `check` for something else, name it `check:pages` and set `check-script: check:pages` in the project's `principles.yml`.

CI picks it up on its own: the shared Principles workflow runs it whenever a project has that script, and keeps the screenshots for a week as a download on the run's page.

## When it fails

Fix the page, not the check. Don't narrow `--pages` or raise the budget to get a change through. If a finding is wrong (axe does misjudge contrast over gradients and images), tell Kyle which one and why before working around it.
