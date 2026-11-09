# Calmer directions (November 9, 2026)

Three looks for the search page, each a stylesheet laid over today's page, for Kyle to pick from.
`shoot.py` serves nothing itself: build (`npm run build`), serve `dist/client` on port 4420, then run
`python3 design/options/shoot.py current a b c` to screenshot each in light and dark.

- `a-hushed.css`: same layout, one accent use, no hit highlighting, lighter titles, filters on one line.
- `b-index.css`: results as a cookbook index (one column, time on a dotted leader, small square photos). Its JS tweak in `shoot.py` puts the time in its own element; the real version would do that in `search.ts`.
- `c-sheet.css`: a contact sheet of square photos with small captions on a neutral near-black.

Nothing here ships until one is picked and folded into `index.astro`, `theme.css` and `design/PLAN.md`.
