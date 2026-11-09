// How often each recipe has been opened in the last 90 days, from Amplitude, written to
// data/popularity.json for scripts/build-index.mjs, which gives often-opened recipes a
// small boost. Counts only: the "Opened Recipe" event's recipe_key ("woks:/mapo-tofu/"),
// never anything about who opened it.
//
//   AMPLITUDE_API_KEY=… AMPLITUDE_SECRET_KEY=… node scripts/popularity.mjs
//
// The keys are the kylepace.dev project's (902556), kept in the GitHub Actions secrets
// AMPLITUDE_API_KEY and AMPLITUDE_SECRET_KEY. Never in code or a chat. Without them this
// does nothing, so the build still works.
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { totals } from '../crawler/lib/popularity.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'data/popularity.json');
const DAYS = 90;

const key = process.env.AMPLITUDE_API_KEY;
const secret = process.env.AMPLITUDE_SECRET_KEY;
if (!key || !secret) {
  console.log('popularity: no Amplitude keys, leaving data/popularity.json as it is');
  process.exit(0);
}

const ymd = (d) => d.toISOString().slice(0, 10).replace(/-/g, '');
const end = new Date();
const start = new Date(end.getTime() - DAYS * 86400000);
const e = {
  event_type: 'Opened Recipe',
  filters: [{ subprop_type: 'event', subprop_key: 'experiment', subprop_op: 'is', subprop_value: ['recipe-search'] }],
  group_by: [{ type: 'event', value: 'recipe_key' }],
};
const url =
  'https://amplitude.com/api/2/events/segmentation' +
  `?e=${encodeURIComponent(JSON.stringify(e))}&m=totals&i=30&start=${ymd(start)}&end=${ymd(end)}&limit=1000`;

const res = await fetch(url, {
  headers: { Authorization: `Basic ${Buffer.from(`${key}:${secret}`).toString('base64')}` },
  signal: AbortSignal.timeout(60000),
});
if (!res.ok) {
  console.error(`popularity: Amplitude answered HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  process.exit(1);
}
const { data } = await res.json();

const opens = totals(data);
const before = existsSync(out) ? JSON.stringify(JSON.parse(readFileSync(out, 'utf8')).opens || {}) : '';
const sorted = Object.fromEntries(Object.entries(opens).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)));
if (JSON.stringify(sorted) === before) console.log('popularity: no change');
else {
  writeFileSync(out, JSON.stringify({ days: DAYS, updated: new Date().toISOString().slice(0, 10), opens: sorted }, null, 1) + '\n');
  console.log(`popularity: ${Object.keys(sorted).length} recipes opened in the last ${DAYS} days`);
}
