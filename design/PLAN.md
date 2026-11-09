# Recipe search: design plan (November 8, 2026, third pass)

**First pass** read as generated: a hero headline over a pill search bar, pills for every control, a grid of identical rounded cards, an eyebrow label, colored squares and middle-dot meta lines.

**Second pass** made the query a sentence ("I have ___ / I want to make ___") set very large. It was distinctive, but two fields and a sentence asked people to learn a new way to search, and the About section sat under the app.

**Third pass (this one):** Kyle's call. A search engine is the right model for a search engine: one box, centered, with the explanation on its own page. What keeps it from looking generated is in the details below, not in a novel layout.

## The subject

People look for a recipe three ways: by dish ("mapo tofu"), by what they have ("ginger, tofu") and by who they trust ("something from Maangchi"). One box takes all three. Words are words; an ingredient or a creator picked from the suggestions becomes a tag in the box, marked like a highlighter on a shopping list.

## Two modes

- **Home** (nothing searched): the name, one line on what's in it, the box, "Pick one at random", and three short lines of ideas (dishes, ingredients, creators). All centered in the window, like a search engine's front page. No filters.
- **Results** (after a search): the name shrinks to a link home in the upper left, the box sits under it, then the filters as words (Cuisine, Creator, Time), then results. Left-aligned.

```
Home                                       Results

          Recipe search                    Recipe search
   2,226 recipes from …, and 3,761 videos  [ from The Woks of Life × | tofu × | and…   (⌕) ]
 [ A dish, ingredient or creator     (⌕) ] Cuisine: any  Creator: The Woks of Life  Time: any  Pick one at random  Start over
          Pick one at random               102 recipes and 4 videos on YouTube.
   Try mapo tofu, pad thai or dumplings.   [photo] How to Make Frozen Tofu
                                                   8 hours 25 minutes, Chinese, from The Woks of Life
```

## The box

- Square-shouldered (0.5rem corners), a 2px rule, the search button inside on the right as a green square with a magnifier. Not a pill.
- Tags: ingredients are filled with scallion green; creators are outlined in it and read "from Maangchi", so the two kinds look different without color alone.
- Suggestions group by what they do: things to add (creators, ingredients, each labeled "Creator" or "Ingredient") above a rule, recipes to open below, then "Search for …".

## About

Its own page (`/recipe-search/about/`), built at build time from the index: why it exists, every creator with counts and ways to support them, how it works, and a note for site owners (the crawler's user agent links here). Top bar: Search and About.

## Color

"Nori" (Kyle's pick from three directions, November 8): a cool off-white with a green cast, and one deep seaweed green. The earlier bright scallion green read as odd.

| Name | Light | Dark | Use |
| --- | --- | --- | --- |
| Page | #F7F8F6 | #101413 | Background |
| Raised | #FFFFFF | #171C1B | The box, menus |
| Ink | #13201D | #E9F0EE | Text |
| Muted | #566461 | #A0AEAA | Secondary text |
| Nori | #1D6B5A / fill #D9ECE6 | #7FC9B6 / fill #1F3A34 | Tags, focus, links, the search button |
| Chili | #B3261E | #FF8F80 | Removing |
| Line | #DFE5E2 | #26302E | Dividers |

No source tints: the photos carry the color.

## Type

Atkinson Hyperlegible Next only. The name is the one large thing on the home page; in results it drops to the size of a heading. Numbers in tabular figures, not monospace.

## Still true from before

Results are rows (photo left), one column on phones, two on wide screens. Meta lines are plain sentences ("25 minutes, Chinese, from The Woks of Life"), never middle dots. No pills, eyebrows or badges.
