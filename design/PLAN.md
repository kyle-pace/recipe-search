# Recipe search: design plan (November 8, 2026, third pass)

**First pass** read as generated: a hero headline over a pill search bar, pills for every control, a grid of identical rounded cards, an eyebrow label, colored squares and middle-dot meta lines.

**Second pass** made the query a sentence ("I have ___ / I want to make ___") set very large. It was distinctive, but two fields and a sentence asked people to learn a new way to search, and the About section sat under the app.

**Third pass:** Kyle's call. A search engine is the right model for a search engine: one box, centered, with the explanation on its own page. What keeps it from looking generated is in the details below, not in a novel layout.

**Fourth pass, "Hushed" (November 9, Kyle's pick of three):** the third pass, with the volume down. It read as cluttered, worst in dark mode: the bright mint did six jobs (button, actions, idea links, active filter, highlights, focus), every result title had its matching word boxed in green, two columns of big bold near-white titles glowed, the filters wrapped to three lines on a phone, and the home page was a wall of about 25 green links. The fixes:

- **Color does one job.** Nori is only for tags, focus and the underline under a filter that's set. The search button and every action are ink.
- **No highlights in result names.** Every result matches, so marking the words again is noise. The suggestions still highlight as you type.
- **Quieter titles:** body size, semi-bold (600).
- **Filters on one short line,** small, each with a ▾. On phones the line scrolls sideways and fades at the edge.
- **Softer dark mode:** a lifted charcoal (#151918) and an off-white (#DFE5E2) instead of near-black and near-white.
- **Home:** the ideas are smaller, in ink, and the creator line names two creators and links to the full list on About.

The other two directions considered: a cookbook-index list (one column, time on a dotted leader) and a contact sheet of square photos. Their stylesheets are on the `design-options` branch.

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

- Square-shouldered (0.5rem corners), a 1px rule at 3:1 contrast, the search button inside on the right as an ink square with a magnifier. Not a pill.
- Tags: ingredients are filled with scallion green; creators are outlined in it and read "from Maangchi", so the two kinds look different without color alone.
- Suggestions group by what they do: things to add (creators, ingredients, each labeled "Creator" or "Ingredient") above a rule, recipes to open below, then "Search for …".

## About

Its own page (`/recipe-search/about/`), built at build time from the index: why it exists, every creator with counts and ways to support them, how it works, and a note for site owners (the crawler's user agent links here). Top bar: Search and About.

## Color

"Nori" (Kyle's pick from three directions, November 8): a cool off-white with a green cast, and one deep seaweed green. The earlier bright scallion green read as odd.

| Name | Light | Dark | Use |
| --- | --- | --- | --- |
| Page | #F7F8F6 | #151918 | Background |
| Raised | #FFFFFF | #1C2120 | The box, menus |
| Ink | #13201D | #DFE5E2 | Text, the search button, actions |
| Muted | #566461 | #98A39F | Secondary text |
| Field rule | #848F8B | #69756F | The box's border, underlines under actions |
| Nori | #1D6B5A / fill #E3EFEB | #8EC3B5 / fill #23302D | Tags, focus, a filter that's set. Nothing else. |
| Chili | #B3261E | #FF8F80 | Removing |
| Line | #E3E8E5 | #262C2B | Dividers |

No source tints: the photos carry the color.

## Type

Atkinson Hyperlegible Next only. The name is the one large thing on the home page; in results it drops to the size of a heading. Numbers in tabular figures, not monospace.

## Still true from before

Results are rows (photo left), one column on phones, two on wide screens. Meta lines are plain sentences ("25 minutes, Chinese, from The Woks of Life"), never middle dots. No pills, eyebrows or badges.
