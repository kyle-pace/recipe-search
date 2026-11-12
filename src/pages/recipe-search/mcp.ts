// Recipe search as an MCP server, at kylepace.dev/recipe-search/mcp: lets an AI assistant
// (Claude, ChatGPT, anything that speaks MCP over Streamable HTTP) search the same index the
// page uses. Read-only, no sign-in, and nothing about the person asking is kept or logged.
//
// This is the only part of the site that runs code on the server; the pages are still
// static files. The answers are worked out in src/mcp/search.mjs.

import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { McpServer } from '@modelcontextprotocol/server';
import { createMcpHandler } from 'agents/mcp/server';
import { z } from 'zod';
import { listSources, prepare, searchRecipes } from '../../mcp/search.mjs';

export const prerender = false;

const VERSION = '0.1.0';
const ROUTE = '/recipe-search/mcp';

// The index is the static file the page loads. It's read once per isolate (a running copy
// of the Worker) and kept ready in memory; each deploy starts fresh isolates, so a new
// crawl is picked up without any cache to clear.
let ready: Promise<ReturnType<typeof prepare>> | null = null;

function loadIndex(origin: string) {
  ready ??= (async () => {
    const assets = (env as { ASSETS?: { fetch: typeof fetch } }).ASSETS;
    if (!assets) throw new Error('The index is not available here');
    const res = await assets.fetch(new URL('/recipe-search/index.json', origin));
    if (!res.ok) throw new Error(`The index answered ${res.status}`);
    return prepare(await res.json());
  })().catch((e) => {
    ready = null; // try again on the next request
    throw e;
  });
  return ready;
}

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const json = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value) }] });
const failed = (e: unknown) => ({
  isError: true,
  content: [{ type: 'text' as const, text: `Could not search right now: ${e instanceof Error ? e.message : 'unknown error'}. Try again in a minute, or use https://kylepace.dev/recipe-search/` }],
});

const strings = z.array(z.string()).max(25);

function createServer(origin: string) {
  const server = new McpServer(
    { name: 'recipe-search', title: 'Recipe search', version: VERSION, websiteUrl: 'https://kylepace.dev/recipe-search/' },
    {
      instructions:
        'Searches a small index of recipes and cooking videos from a hand-picked set of trusted recipe sites. ' +
        'Use search_recipes to find recipes by dish name, by ingredients to cook with, or both; use list_sources to see who is indexed and how to support them. ' +
        'The index holds names, links, ingredient names, times and cuisines only, never the method: always give the link so the person can read the recipe on the original site, and say which site it is from. ' +
        'Do not write out a recipe as if it came from these results.',
    },
  );

  server.registerTool(
    'search_recipes',
    {
      title: 'Search recipes',
      description:
        'Find recipes from trusted recipe sites (The Woks of Life, Hot Thai Kitchen, Smitten Kitchen, RecipeTin Eats and others; see list_sources). ' +
        'Search by dish (`query`), by what you have to cook with (`ingredients`), or both. With ingredients, recipes that use more of them and need fewer other things come first, and each result lists what it uses and what else it needs. ' +
        'Each result is a name, a link to the original recipe, the site, and time and cuisine when known. Matching YouTube videos from the same creators come along, labeled as YouTube.',
      inputSchema: z.object({
        query: z.string().max(200).optional().describe("Words for the dish, matched in recipe names and keywords, for example 'mapo tofu' or 'noodle soup'. Not for ingredients you have: put those in `ingredients`."),
        ingredients: strings.optional().describe("Things to cook with, one per item, by plain name: ['chicken thighs', 'bok choy', 'tofu']. A recipe must use at least one."),
        without: strings.optional().describe("Ingredients to leave out: ['pork', 'peanuts']."),
        diet: z.enum(['vegetarian', 'vegan']).optional().describe('Leave out recipes with meat or seafood (vegetarian), and also dairy, eggs and honey (vegan). A best guess from ingredient lists.'),
        cuisine: z.string().max(60).optional().describe("A cuisine as listed by list_sources, for example 'Chinese', 'Thai', 'Japanese'."),
        max_minutes: z.number().int().min(1).max(1440).optional().describe('Only recipes whose total time is known and at most this many minutes.'),
        creator: z.string().max(80).optional().describe("Only one creator, by name: 'The Woks of Life', 'Kenji'."),
        videos: z.boolean().optional().describe('Set false to leave YouTube videos out. Default true.'),
        limit: z.number().int().min(1).max(30).optional().describe('How many recipes to return. Default 10.'),
      }),
      annotations: READ_ONLY,
    },
    async (args) => {
      try {
        return json(searchRecipes(await loadIndex(origin), args));
      } catch (e) {
        return failed(e);
      }
    },
  );

  server.registerTool(
    'list_sources',
    {
      title: 'Sources and cuisines',
      description:
        'Who is in the recipe index: each creator with their site, how many recipes and videos, and ways to support them (cookbooks, memberships, Patreon). Also the cuisines that can be filtered on, and sites that are not indexed but can be searched directly.',
      inputSchema: z.object({}),
      annotations: READ_ONLY,
    },
    async () => {
      try {
        return json(listSources(await loadIndex(origin)));
      } catch (e) {
        return failed(e);
      }
    },
  );

  return server;
}

// Where a person who opens the address in a browser is sent: the About page's section on
// AI assistants, which has the Add to Claude button.
const PAGE = 'https://kylepace.dev/recipe-search/about/#assistants';

export const ALL: APIRoute = async ({ request, locals }) => {
  // A person opening the address in a browser is sent to the page about it, not shown an error.
  if (request.method === 'GET' && !(request.headers.get('accept') || '').includes('text/event-stream')) {
    return Response.redirect(PAGE, 302);
  }
  const url = new URL(request.url);
  const origin = url.origin;
  // The handler answers one exact path, so a trailing slash is trimmed first.
  if (url.pathname !== ROUTE) {
    url.pathname = ROUTE;
    request = new Request(url, request);
  }
  const ctx = (locals as { cfContext?: ExecutionContext }).cfContext ?? { waitUntil() {}, passThroughOnException() {}, props: {} };
  const handler = createMcpHandler(() => createServer(origin), {
    route: ROUTE,
    // The handler only answers hosts it knows: the live domain, and localhost for `npm run preview`.
    allowedHostnames: ['kylepace.dev', 'localhost', '127.0.0.1'],
  });
  return handler(request, env as never, ctx as ExecutionContext);
};
