# Recipe search

One search box across the recipe sites I trust: The Woks of Life, Just One Cookbook, Hot Thai Kitchen, Smitten Kitchen, Maangchi, and J. Kenji López-Alt's YouTube videos. It runs on our own small index, not Google, and every result opens on the original site.

**Status:** prototype (November 1, 2026). Working name; the real name and domain are still open.

## How it will work

1. A weekly job checks each site's robots.txt, reads its sitemap, and keeps only the data needed to find a recipe: title, link, ingredient names, time and cuisine. Never the method.
2. Kenji's videos come from the official YouTube Data API.
3. Ingredients are matched to KitchenCatalog names, so "scallions" and "green onion" find the same recipes.
4. The data becomes a static search index that runs in the browser. Free to host, no server.
5. Sites we can't index, like Serious Eats, get an "Also search" link instead.

See `sources.yaml` for every source and why it's in or out, and `CLAUDE.md` for the rules.

## The prototype

```sh
python3 prototype/build.py   # writes prototype/index.html
```

Open `prototype/index.html` in a browser. It uses a small real sample: 34 recipes and 14 videos.
