#!/usr/bin/env node
// The weekly crawl. For each recipe site in sources.yaml: check robots.txt,
// read the sitemap, fetch only pages that are new or changed (one at a time,
// a few seconds apart), and keep only what's needed to find a recipe.
// Video channels come from the YouTube Data API. Writes data/<id>.json,
// state/<id>.json and data/status.json.
//
//   node crawler/crawl.mjs [--sources woks,sk] [--limit 20] [--budget-minutes 300]
//                          [--delay-ms 4000] [--dry-run] [--no-videos] [--sample 2]

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { robotsFor } from './lib/robots.mjs';
import { readSitemaps } from './lib/sitemap.mjs';
import { extractRecipe } from './lib/extract.mjs';
import { fetchChannelVideos } from './lib/youtube.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BOT = 'RecipeSearchBot';
const UA = `Mozilla/5.0 (compatible; ${BOT}/0.1; +https://kylepace.net)`;
const MIN_DELAY_MS = 3000;
const REFETCH_WITHOUT_LASTMOD_DAYS = 90;
const DROP_ALERT = 0.9; // alert when a source keeps fewer than 90% of last run's recipes

const args = parseArgs(process.argv.slice(2));
const started = Date.now();
const deadline = started + Number(args['budget-minutes'] || 300) * 60000;
const delayMs = Math.max(MIN_DELAY_MS, Number(args['delay-ms'] || 4000));
const limit = args.limit ? Number(args.limit) : Infinity;
const only = args.sources ? new Set(String(args.sources).split(',')) : null;
const dryRun = Boolean(args['dry-run']);
const today = new Date().toISOString().slice(0, 10);

const sources = parseYaml(await readFile(join(ROOT, 'sources.yaml'), 'utf8'));
const previousStatus = await readJson(join(ROOT, 'data/status.json'), { sources: {} });
const status = { run: new Date().toISOString(), options: { limit: args.limit ? limit : null, delayMs }, sources: {}, alerts: [] };

const recipeJobs = (sources.recipes || [])
  .filter((s) => !only || only.has(s.id))
  .map((s) => (s.paused ? Promise.resolve({ id: s.id, name: s.name, result: 'paused', error: s.paused }) : crawlSite(s)).catch((err) => ({ id: s.id, name: s.name, result: 'error', error: err.message })));
const results = await Promise.all(recipeJobs);
for (const r of results) status.sources[r.id] = r;

if (!args['no-videos']) {
  for (const v of (sources.videos || []).filter((s) => !only || only.has(s.id))) {
    status.sources[v.id] = await crawlVideos(v).catch((err) => ({ id: v.id, name: v.name, result: 'error', error: err.message }));
  }
}

for (const [id, s] of Object.entries(status.sources)) {
  const before = previousStatus.sources?.[id]?.count;
  if (s.result === 'blocked') status.alerts.push(`${id}: blocked (${s.error})`);
  else if (s.result === 'error') status.alerts.push(`${id}: failed (${s.error})`);
  if (before > 20 && s.count != null && s.count < before * DROP_ALERT) {
    status.alerts.push(`${id}: recipe count dropped from ${before} to ${s.count}`);
  }
  // Keep counts for sources that didn't run this time.
}
for (const [id, s] of Object.entries(previousStatus.sources || {})) {
  if (!status.sources[id]) status.sources[id] = { ...s, result: 'not run' };
}

if (!dryRun) await writeJson(join(ROOT, 'data/status.json'), status);
await report(status);

// ---------------------------------------------------------------------------

async function crawlSite(src) {
  const log = (msg) => console.log(`[${src.id}] ${msg}`);
  const host = new URL(src.site).host.replace(/^www\./, '');
  const out = { id: src.id, name: src.name, result: 'ok', fetched: 0, added: 0, updated: 0, removed: 0, noRecipe: 0, httpErrors: {} };

  // robots.txt: RFC 9309 says 4xx means "no rules", but a 401/403/429 on
  // robots.txt itself almost always means a firewall is turning us away.
  const robotsRes = await get(`${src.site}/robots.txt`).catch((err) => ({ status: 0, error: err.message }));
  if ([401, 403, 429].includes(robotsRes.status)) return { ...out, result: 'blocked', error: `HTTP ${robotsRes.status} on robots.txt` };
  if (robotsRes.status === 0 || robotsRes.status >= 500) return { ...out, result: 'error', error: `robots.txt unreachable (${robotsRes.error || 'HTTP ' + robotsRes.status})` };
  const robots = robotsFor(robotsRes.status === 200 ? robotsRes.text : '', BOT);
  const sitemapUrl = new URL(src.sitemap, src.site).href;
  if (!robots.allowed('/') && !robots.allowed(sitemapUrl)) return { ...out, result: 'blocked', error: 'robots.txt disallows us' };
  const pause = Math.max(delayMs, (robots.crawlDelay || 0) * 1000);

  const include = src.include ? new RegExp(src.include) : null;
  const entries = await readSitemaps(sitemapUrl, (u, o) => getOk(u, o), { include, log });
  const inSitemap = new Map();
  for (const e of entries) {
    const u = normalize(e.loc);
    if (u && sameSite(u, host)) inSitemap.set(u, e.lastmod);
  }
  log(`${inSitemap.size} pages in the sitemap`);
  out.sitemapPages = inSitemap.size;

  const dataPath = join(ROOT, `data/${src.id}.json`);
  const statePath = join(ROOT, `state/${src.id}.json`);
  const recipes = new Map((await readJson(dataPath, [])).map((r) => [r.u, r]));
  const state = await readJson(statePath, {});

  // Pages no longer in the sitemap are gone from the site.
  for (const u of Object.keys(state)) {
    if (!inSitemap.has(u)) {
      delete state[u];
      if (recipes.delete(u)) out.removed++;
    }
  }

  const todo = [];
  for (const [u, lastmod] of inSitemap) {
    if (!robots.allowed(u)) continue;
    const seen = state[u];
    if (!seen) todo.push({ u, lastmod });
    else if (lastmod && (!seen.m || lastmod > seen.m)) todo.push({ u, lastmod });
    else if (!lastmod && daysSince(seen.f) > REFETCH_WITHOUT_LASTMOD_DAYS) todo.push({ u, lastmod });
  }
  todo.sort((a, b) => String(b.lastmod || '').localeCompare(String(a.lastmod || '')));
  out.waiting = todo.length;
  log(`${todo.length} new or changed; fetching ${Math.min(todo.length, limit)}`);

  let refusedInARow = 0;
  for (const { u, lastmod } of todo.slice(0, limit)) {
    if (Date.now() > deadline) {
      log('time budget used up; the rest waits for the next run');
      out.stoppedEarly = true;
      break;
    }
    await sleep(pause);
    let res;
    try {
      res = await get(u);
    } catch (err) {
      out.httpErrors.network = (out.httpErrors.network || 0) + 1;
      continue;
    }
    out.fetched++;
    if (res.status !== 200) {
      out.httpErrors[res.status] = (out.httpErrors[res.status] || 0) + 1;
      if ([401, 403, 429].includes(res.status)) {
        if (++refusedInARow >= 3) {
          out.result = 'blocked';
          out.error = `HTTP ${res.status} three times in a row`;
          break;
        }
      }
      if (res.status === 404 || res.status === 410) {
        delete state[u];
        if (recipes.delete(u)) out.removed++;
      }
      continue;
    }
    refusedInARow = 0;
    if (!sameSite(res.url, host)) {
      state[u] = { m: lastmod, r: 0, f: today };
      continue;
    }
    const recipe = extractRecipe(res.text, u, { format: src.format, defaultCuisine: src.default_cuisine });
    state[u] = { m: lastmod, r: recipe ? 1 : 0, f: today };
    if (!recipe) {
      out.noRecipe++;
      recipes.delete(u);
      continue;
    }
    if (recipes.has(u)) out.updated++;
    else out.added++;
    recipes.set(u, recipe);
  }

  if (args.sample) {
    const fresh = todo.slice(0, limit).map((x) => recipes.get(x.u)).filter(Boolean).slice(0, Number(args.sample) || 2);
    for (const r of fresh) log(`sample: ${JSON.stringify(r)}`);
  }
  out.count = recipes.size;
  out.waiting = Math.max(0, out.waiting - out.fetched);
  if (out.fetched >= 5 && out.fetched === out.noRecipe) {
    out.note = 'no recipe data found on any fetched page; check the reader or the include pattern';
  }
  if (!dryRun) {
    await writeJson(dataPath, [...recipes.values()].sort((a, b) => a.u.localeCompare(b.u)));
    await writeJson(statePath, Object.fromEntries(Object.entries(state).sort(([a], [b]) => a.localeCompare(b))));
  }
  log(`done: ${out.added} added, ${out.updated} updated, ${out.removed} removed, ${out.noRecipe} without a recipe, ${out.count} total`);
  return out;
}

async function crawlVideos(src) {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) return { id: src.id, name: src.name, result: 'skipped', error: 'no YOUTUBE_API_KEY secret yet' };
  const videos = await fetchChannelVideos(src.channel, key);
  if (!dryRun) await writeJson(join(ROOT, `data/${src.id}.json`), videos);
  console.log(`[${src.id}] ${videos.length} public videos`);
  return { id: src.id, name: src.name, result: 'ok', count: videos.length };
}

// ---- HTTP

async function get(url, { binary = false } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' },
        redirect: 'follow',
        signal: AbortSignal.timeout(30000),
      });
      if (res.status >= 500 && attempt === 0) {
        await sleep(10000);
        continue;
      }
      const body = binary ? Buffer.from(await res.arrayBuffer()) : await res.text();
      return { status: res.status, url: res.url, text: body };
    } catch (err) {
      if (attempt === 0) {
        await sleep(10000);
        continue;
      }
      throw err;
    }
  }
}

async function getOk(url, opts) {
  await sleep(delayMs);
  const res = await get(url, opts);
  if (res.status !== 200) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text;
}

// ---- Helpers

function normalize(u) {
  try {
    const x = new URL(u);
    x.hash = '';
    return x.href;
  } catch {
    return null;
  }
}

function sameSite(u, host) {
  try {
    return new URL(u).host.replace(/^www\./, '') === host;
  } catch {
    return false;
  }
}

function daysSince(date) {
  return date ? (Date.now() - Date.parse(date)) / 86400000 : Infinity;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function readJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return fallback;
  }
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  // One record per line keeps Git diffs readable.
  let text;
  if (Array.isArray(value)) text = '[\n' + value.map((v) => JSON.stringify(v)).join(',\n') + '\n]\n';
  else if (path.includes('/state/')) {
    text = '{\n' + Object.entries(value).map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(',\n') + '\n}\n';
  } else text = JSON.stringify(value, null, 1) + '\n';
  await writeFile(path, text);
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next != null && !next.startsWith('--')) {
      out[key] = next;
      i++;
    } else out[key] = true;
  }
  return out;
}

async function report(s) {
  const rows = Object.values(s.sources).map((x) =>
    `| ${x.name || x.id} | ${x.result}${x.error ? ` (${x.error})` : ''} | ${x.count ?? ''} | ${x.fetched ?? ''} | ${x.added ?? ''} | ${x.noRecipe ?? ''} | ${x.waiting ?? ''} | ${Object.entries(x.httpErrors || {}).map(([k, v]) => `${k}×${v}`).join(' ')} |`,
  );
  const md = [
    `## Crawl ${s.run.slice(0, 16).replace('T', ' ')} UTC${dryRun ? ' (dry run)' : ''}`,
    '',
    '| Source | Result | Recipes | Fetched | Added | No recipe | Still waiting | HTTP errors |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
    ...rows,
    '',
    s.alerts.length ? `**Alerts:**\n${s.alerts.map((a) => `- ${a}`).join('\n')}` : 'No alerts.',
    ...Object.values(s.sources).filter((x) => x.note).map((x) => `- ${x.id}: ${x.note}`),
    '',
  ].join('\n');
  console.log('\n' + md);
  if (process.env.GITHUB_STEP_SUMMARY) await writeFile(process.env.GITHUB_STEP_SUMMARY, md, { flag: 'a' });
}
