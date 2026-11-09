# Recipe search: design plan (November 8, 2026, second pass)

The first pass read as generated: a hero headline over a pill search bar, pills for every control, a grid of identical rounded cards, an eyebrow label, colored squares and middle-dot meta lines. None of it came from the subject.

## The subject

People don't search for recipes in keywords. They say "I have ginger, scallions and some tofu" or "I want to make mapo tofu." The page should be that sentence.

## The one bold thing

The query is a sentence set large: **I have** ___ and **I want to make** ___. Ingredients you add become words in the sentence, marked like a highlighter on a shopping list. Everything else on the page is quiet.

## Color

| Name | Light | Dark | Use |
| --- | --- | --- | --- |
| Rice | #FFFFFF | #121314 | Page |
| Soy | #141414 | #F1F1EE | Text |
| Ash | #5D625F | #A6ABA8 | Secondary text |
| Scallion | #2C7A36 / fill #CDEBC9 | #86D08E / fill #24442A | The words you add, focus, links |
| Chili | #B8261A | #FF8F80 | Removing, nothing-found fixes |
| Shelf | #E4E6E1 | #2A2D2B | Input rule, dividers |

No source tints: the photos carry the color.

## Type

Atkinson Hyperlegible Next only (the principles). Personality comes from scale and weight: the sentence at about 3.5rem, "I have" in light 300 and Ash, your words in bold 700. Everything else at one or two small sizes. Numbers in tabular figures, not monospace.

## Layout

```
‹ kylepace.dev

Recipe search
Searches The Woks of Life, Hot Thai Kitchen and Smitten Kitchen.

I have  ginger  tofu  an ingredient___
I want to make  any dish___________          [Find recipes]

Cuisine: any    Site: any    Time: any

933 recipes use at least one.

[photo]  Cantonese-Style Steamed Tofu
         25 minutes, Chinese, from The Woks of Life
         Uses ginger, green onion and tofu, plus 2 more things
```

Left-aligned throughout. Results are rows (photo left), one column on phones, two on wide screens. No pills anywhere; controls are words.

## Principles

- The page is the sentence. Labels, filters and empty states read as plain language.
- Spend boldness once (the sentence). No badges, no eyebrows, no decorative color.
- Structure only where it carries information.
