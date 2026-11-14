#!/usr/bin/env node
// The check command for Kyle's web projects (`npm run check`), from "Before you call it
// done" in the principles. This file is synced from github.com/kyle-pace/principles
// (skills/page-check/); edit it there. See SKILL.md next to it for setup.
//
// Run it from the project's root after a build. For every built page it:
//
//   1. runs axe (the accessibility checker) in light and dark, at phone and desktop width
//   2. fails if the page scrolls sideways at 320, 768, 1280 or 1920 px
//   3. fails if the page ships more JavaScript than the budget (50 KB compressed)
//   4. saves a full-page screenshot at each width in light and dark to .check/
//
// The screenshots are for looking at; the first three fail the run.
//
// Usage: node .agents/skills/page-check/check.mjs [options]
//   --dir dist/client     where the build is (default: the first of dist/client, dist, _site that exists, else .)
//   --pages /apps/,/labs/ only these pages
//   --js-budget 400       a different JavaScript budget in KB, for a project whose section
//                         of AGENTS.md says it needs one (a map, a globe)
//   --no-shots            skip the screenshots
//   CHROME=/path/to/chrome uses that browser instead of Playwright's own.
//
// Needs `playwright` and `axe-core` in the project's devDependencies. It only sees pages
// built to HTML files; pages rendered on the server at request time aren't covered.

import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync, readdirSync, mkdirSync, rmSync } from 'node:fs';
import { join, extname } from 'node:path';
import { createRequire } from 'node:module';
import { gzipSync } from 'node:zlib';
import { chromium } from 'playwright';

const root = process.cwd();
const args = process.argv.slice(2);
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);

const dist = join(
  root,
  option('--dir') ?? ['dist/client', 'dist', '_site'].find((dir) => existsSync(join(root, dir))) ?? '.',
);
const out = join(root, '.check');

const WIDTHS = [320, 768, 1280, 1920];
const AXE_WIDTHS = [320, 1280];
const THEMES = ['light', 'dark'];
const JS_BUDGET_KB = Number(option('--js-budget') ?? 50);
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

const only = option('--pages')?.split(',') ?? null;
const shots = !args.includes('--no-shots');

if (!existsSync(dist)) {
  console.error(`No built site in ${dist}. Build the project first, or pass --dir.`);
  process.exit(2);
}

// Every built page: each folder with an index.html, plus the 404 page.
function findPages(dir, route = '/') {
  const pages = [];
  if (existsSync(join(dir, 'index.html'))) pages.push(route);
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && !/^[_.]|^node_modules$/.test(entry.name)) {
      pages.push(...findPages(join(dir, entry.name), `${route}${entry.name}/`));
    }
  }
  return pages;
}
let pages = findPages(dist);
if (existsSync(join(dist, '404.html'))) pages.push('/404.html');
if (only) pages = pages.filter((page) => only.includes(page));
if (!pages.length) {
  console.error(`No pages to check in ${dist}. Build the project first, or pass --dir.`);
  process.exit(2);
}

// A tiny static server for the built site, so pages load the way they do when live.
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
  '.xml': 'application/xml',
  '.txt': 'text/plain',
};
function fileFor(urlPath) {
  const clean = decodeURIComponent(urlPath.split('?')[0]);
  if (clean.includes('..')) return null;
  let file = join(dist, clean);
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
  return existsSync(file) ? file : null;
}
const server = createServer((req, res) => {
  const file = fileFor(req.url);
  if (!file) {
    res.writeHead(404, { 'content-type': TYPES['.html'] });
    res.end(existsSync(join(dist, '404.html')) ? readFileSync(join(dist, '404.html')) : 'Not found');
    return;
  }
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
  res.end(readFileSync(file));
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;

// JavaScript weight: every script the page's HTML points at, plus inline scripts, gzipped.
function scriptWeight(page) {
  const html = readFileSync(fileFor(page), 'utf8');
  let bytes = 0;
  for (const [, attrs, body] of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
    if (/type="application\/(ld\+)?json"/.test(attrs)) continue;
    const src = attrs.match(/src="([^"]+)"/)?.[1];
    if (src) {
      const file = src.startsWith('/') ? fileFor(src) : null;
      if (file) bytes += gzipSync(readFileSync(file)).length;
    } else if (body.trim()) {
      bytes += gzipSync(body).length;
    }
  }
  for (const [, href] of html.matchAll(/<link\b[^>]*rel="modulepreload"[^>]*href="([^"]+)"/g)) {
    const file = fileFor(href);
    if (file) bytes += gzipSync(readFileSync(file)).length;
  }
  return bytes / 1024;
}

const axeSource = readFileSync(createRequire(join(root, 'package.json')).resolve('axe-core/axe.min.js'), 'utf8');
const browser = await chromium.launch({
  ...(process.env.CHROME ? { executablePath: process.env.CHROME } : {}),
  // Software rendering, so pages that draw with WebGL (a globe, a map) still paint.
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});

if (shots) {
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
}

const problems = [];
const notes = [];
const name = (page) => (page === '/' ? 'home' : page.replace(/^\/|\/$|\.html$/g, '').replace(/\//g, '-'));

for (const page of pages) {
  const kb = scriptWeight(page);
  if (kb > JS_BUDGET_KB) {
    problems.push(`${page}: ships ${kb.toFixed(0)} KB of JavaScript (budget ${JS_BUDGET_KB} KB)`);
  }

  for (const theme of THEMES) {
    const context = await browser.newContext({ colorScheme: theme, reducedMotion: 'reduce' });
    const tab = await context.newPage();
    for (const width of WIDTHS) {
      await tab.setViewportSize({ width, height: 900 });
      // Pages that keep talking to a server (live data) never go quiet; settle for loaded.
      await tab
        .goto(origin + page, { waitUntil: 'networkidle', timeout: 20_000 })
        .catch(() => tab.goto(origin + page, { waitUntil: 'load' }));

      const overflow = await tab.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      if (overflow > 1) problems.push(`${page}: scrolls sideways by ${overflow}px at ${width}px (${theme})`);

      if (AXE_WIDTHS.includes(width)) {
        await tab.evaluate(axeSource);
        const { violations } = await tab.evaluate(
          (tags) => window.axe.run(document, { runOnly: { type: 'tag', values: tags } }),
          AXE_TAGS,
        );
        for (const violation of violations) {
          const where = violation.nodes
            .slice(0, 3)
            .map((node) => node.target.join(' '))
            .join('; ');
          problems.push(
            `${page}: ${violation.id} at ${width}px (${theme}): ${violation.help}. ${violation.nodes.length} place(s): ${where}`,
          );
        }
      }

      if (shots) {
        // A page that never stops animating can time a screenshot out. That's worth knowing, not failing on.
        await tab
          .screenshot({ path: join(out, `${name(page)}-${width}-${theme}.png`), fullPage: true, timeout: 15_000 })
          .catch(() => notes.push(`${page}: no screenshot at ${width}px (${theme}); look at this one by hand`));
      }
    }
    await context.close();
  }
  console.log(`checked ${page} (${kb.toFixed(0)} KB of JavaScript)`);
}

await browser.close();
server.close();

if (shots) console.log(`\nScreenshots are in .check/ (${pages.length * WIDTHS.length * THEMES.length} files).`);
if (notes.length) console.log(`\nNot checked:\n` + notes.map((note) => `  - ${note}`).join('\n'));
if (problems.length) {
  const unique = [...new Set(problems)];
  console.error(`\n${unique.length} problem(s):\n` + unique.map((problem) => `  - ${problem}`).join('\n'));
  process.exit(1);
}
console.log(`\nAll clear: ${pages.length} page(s), no accessibility findings, no sideways scrolling, JavaScript within budget.`);
