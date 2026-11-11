// Talk to the MCP endpoint the way an assistant would, with the official MCP client:
// connect, list the tools, run a few searches, and print short results.
//
//   npm run preview                  (in another terminal)
//   npm run try-mcp                  (uses http://localhost:8787/recipe-search/mcp)
//   npm run try-mcp -- https://kylepace.dev/recipe-search/mcp
//
// Exits non-zero if anything fails, so it works as a check after a deploy.
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

const url = process.argv[2] ?? 'http://localhost:8787/recipe-search/mcp';
const client = new Client({ name: 'try-script', version: '0.1.0' });
await client.connect(new StreamableHTTPClientTransport(new URL(url)));
const info = client.getServerVersion();
console.log(`Connected to ${info?.title ?? info?.name} ${info?.version} at ${url}`);
console.log(`Tools: ${(await client.listTools()).tools.map((t) => t.name).join(', ')}`);

let failures = 0;
async function call(name, args, check) {
  const started = Date.now();
  const res = await client.callTool({ name, arguments: args });
  const text = res.content?.[0]?.text ?? '';
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {}
  const problem = res.isError ? text : !data ? 'not JSON' : check(data);
  if (problem) failures++;
  console.log(`\n${problem ? 'FAIL' : 'ok  '} ${name}(${JSON.stringify(args)}) ${Date.now() - started} ms${problem ? `: ${problem}` : ''}`);
  return data;
}
const show = (d) => {
  for (const r of d?.recipes ?? []) console.log(`     ${r.name} (${r.from}${r.time ? `, ${r.time}` : ''})${r.uses ? ` uses ${r.uses.join(', ')}; also needs ${r.also_needs.length}` : ''}\n       ${r.url}`);
  for (const v of d?.videos ?? []) console.log(`     [YouTube] ${v.title} (${v.channel})`);
  for (const n of d?.notes ?? []) console.log(`     note: ${n}`);
};

show(await call('search_recipes', { query: 'mapo tofu', limit: 4 }, (d) => (d.recipes?.length && d.recipes.every((r) => /^https:\/\//.test(r.url)) ? null : 'no recipes with links')));
show(await call('search_recipes', { ingredients: ['chicken thighs', 'bok choy', 'tofu'], max_minutes: 45, videos: false, limit: 4 }, (d) => (d.recipes?.[0]?.uses?.length ? null : 'no ingredient matches')));
show(await call('search_recipes', { query: 'noodles', diet: 'vegetarian', cuisine: 'thai', limit: 3 }, (d) => (d.recipes?.every((r) => r.cuisine === 'Thai') ? null : 'cuisine filter not applied')));
await call('search_recipes', { query: 'soup', cuisine: 'martian' }, (d) => (d.error && d.cuisines?.length ? null : 'expected a helpful error'));
const src = await call('list_sources', {}, (d) => (d.creators?.length ? null : 'no creators'));
if (src) console.log(`     ${src.recipe_count} recipes, ${src.video_count} videos from ${src.creators.map((c) => c.name).join(', ')}`);

await client.close();
if (failures) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log('\nAll good.');
