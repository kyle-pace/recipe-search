// @ts-check
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';

// Recipe search lives at kylepace.dev/recipe-search/. It's its own Worker, mounted on
// that path by the routes in wrangler.jsonc; the hub (kyle-pace/kylepace.dev) serves
// everything else on the domain, including the favicon and robots.txt.
// Everything this site serves sits under /recipe-search/: the page is
// src/pages/recipe-search/, public files go in public/recipe-search/, and built assets go
// to /recipe-search/_astro/. (Astro's `base` option isn't used: with the Cloudflare
// adapter it serves the files from the wrong folder.)
export default defineConfig({
  site: 'https://kylepace.dev',
  build: { assets: 'recipe-search/_astro' },
  session: false,
  adapter: cloudflare({ imageService: 'compile' }),
});
