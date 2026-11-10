// Trusted recipe sources for JavaScript (Recipe search's crawler and index, World cuisine).
// The list is recipe-sources/sources.json; the field reference is recipe-sources/schema.md.
//
//   import { loadSources, validateSources } from "./sources.mjs";
//   const { sources } = loadSources();
//   const problems = validateSources(loadSources()); // [] when every entry is well formed
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
export const SOURCES_PATH = join(here, "..", "recipe-sources", "sources.json");

export const KINDS = ["site", "channel", "magazine"];
export const STATUSES = ["crawl", "paused", "link-only", "youtube-only", "permission-needed", "not-checked"];
export const REGIONS = ["africa", "americas", "asia-east", "asia-rest", "europe", "oceania-other"];
export const FORMATS = ["json-ld", "microdata"];

const FIELDS = ["id", "name", "url", "kind", "vetted", "cuisines", "note", "region", "youtube", "collect", "crawl", "search", "search_label", "search_note", "support"];
const CRAWL_FIELDS = ["sitemap", "include", "format", "default_cuisine", "delay_seconds", "photos", "size", "notes"];

export function loadSources(path = SOURCES_PATH) {
  return JSON.parse(readFileSync(path, "utf8"));
}

/** Every problem found, as "id: what's wrong". An empty list means the file is good. */
export function validateSources(data) {
  const problems = [];
  if (!Number.isInteger(data?.version)) problems.push("file: version must be a whole number");
  if (!Array.isArray(data?.sources)) return [...problems, "file: sources must be a list"];

  const ids = new Set();
  const videoIds = new Map(); // YouTube data ids (a site's youtube.id or a channel's own id) -> owner
  const https = (u) => typeof u === "string" && /^https:\/\/[^\s/]+\.[^\s]+$/.test(u);
  const onYouTube = (u) => https(u) && /^https:\/\/(www\.)?youtube\.com\//.test(u);
  const text = (s) => typeof s === "string" && s.trim() !== "";

  for (const [n, s] of data.sources.entries()) {
    const id = s?.id ?? `#${n}`;
    const bad = (msg) => problems.push(`${id}: ${msg}`);
    if (!/^[a-z0-9][a-z0-9-]*$/.test(s?.id ?? "")) bad("id must be lowercase letters, digits and dashes");
    else if (ids.has(s.id)) bad("id is used twice");
    else ids.add(s.id);
    for (const k of Object.keys(s)) if (!FIELDS.includes(k)) bad(`unknown field ${k}`);
    if (!text(s.name)) bad("name is missing");
    if (!https(s.url)) bad("url must be an https URL");
    if (!KINDS.includes(s.kind)) bad(`kind must be one of ${KINDS.join(", ")}`);
    if (s.kind === "channel" && !onYouTube(s.url)) bad("a channel's url must be its YouTube page");
    if (typeof s.vetted !== "boolean") bad("vetted must be true or false");
    if (!Array.isArray(s.cuisines) || !s.cuisines.every(text)) bad("cuisines must be a list of Wikipedia page titles");
    else if (new Set(s.cuisines).size !== s.cuisines.length) bad("a cuisine is listed twice");
    if (!text(s.note)) bad("note is missing");
    if ("region" in s && !REGIONS.includes(s.region)) bad(`region must be one of ${REGIONS.join(", ")}`);

    const c = s.collect;
    if (!c || !STATUSES.includes(c.status)) bad(`collect.status must be one of ${STATUSES.join(", ")}`);
    else if (c.status !== "not-checked") {
      if (!text(c.reason)) bad("collect.reason is missing");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(c.checked ?? "")) bad("collect.checked must be a date (YYYY-MM-DD)");
    }
    if (c && Object.keys(c).some((k) => !["status", "reason", "checked"].includes(k))) bad("collect has an unknown field");

    if (["crawl", "paused"].includes(c?.status) && !s.crawl) bad(`a ${c.status} source needs crawl`);
    if (s.crawl) {
      const k = s.crawl;
      for (const f of Object.keys(k)) if (!CRAWL_FIELDS.includes(f)) bad(`unknown crawl field ${f}`);
      if (s.kind === "channel") bad("a channel can't have crawl");
      if (!/^\/\S*$/.test(k.sitemap ?? "")) bad("crawl.sitemap must be a path starting with /");
      if (!FORMATS.includes(k.format)) bad(`crawl.format must be one of ${FORMATS.join(", ")}`);
      if ("include" in k) {
        try { new RegExp(k.include); } catch { bad("crawl.include isn't a valid pattern"); }
      }
      if ("delay_seconds" in k && !(typeof k.delay_seconds === "number" && k.delay_seconds > 0)) bad("crawl.delay_seconds must be a positive number");
      if ("photos" in k && typeof k.photos !== "boolean") bad("crawl.photos must be true or false");
      if ("notes" in k && !(Array.isArray(k.notes) && k.notes.every(text))) bad("crawl.notes must be a list of lines");
    }

    if (c?.status === "link-only" && !s.search) bad("a link-only source needs search");
    if ("search" in s && !(https(s.search) && s.search.includes("{q}"))) bad("search must be an https URL with {q} where the words go");
    if (("search_label" in s || "search_note" in s) && !s.search) bad("search_label and search_note need search");

    if (s.youtube) {
      const y = s.youtube;
      if (s.kind === "channel") bad("a channel is its own YouTube source; leave out youtube");
      if (!/^[a-z0-9][a-z0-9-]*$/.test(y.id ?? "")) bad("youtube.id must be lowercase letters, digits and dashes");
      if (!onYouTube(y.url)) bad("youtube.url must be a YouTube URL");
      if (Object.keys(y).some((k) => !["id", "url", "note"].includes(k))) bad("youtube has an unknown field");
    }
    // Recipe search keeps each source's data in data/<id>.json, so a YouTube id can't be anyone else's id.
    const vid = s.youtube?.id ?? (s.kind === "channel" ? s.id : null);
    if (vid) {
      if (videoIds.has(vid)) bad(`YouTube id ${vid} is also ${videoIds.get(vid)}'s`);
      videoIds.set(vid, s.id);
    }

    if (s.support) {
      const { links = [], books = [], ...rest } = s.support;
      if (Object.keys(rest).length) bad("support has an unknown field");
      if (!links.every((l) => text(l.label) && https(l.url))) bad("support.links need a label and an https url");
      if (!books.every((b) => text(b.title) && /^97[89]\d{10}$/.test(b.isbn ?? ""))) bad("support.books need a title and an ISBN-13");
    }
  }
  for (const [vid, owner] of videoIds) if (vid !== owner && ids.has(vid)) problems.push(`${owner}: YouTube id ${vid} is also a source id`);
  return problems;
}
