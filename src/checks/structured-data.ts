import * as cheerio from "cheerio";
import type { Finding } from "../types.js";

export interface PageJsonLd {
  url: string;
  blocks: unknown[];
  parseErrors: string[];
}

export function extractJsonLd(url: string, html: string): PageJsonLd {
  const $ = cheerio.load(html);
  const blocks: unknown[] = [];
  const parseErrors: string[] = [];

  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).contents().text();
    if (!raw.trim()) return;
    try {
      blocks.push(JSON.parse(raw));
    } catch (err) {
      parseErrors.push(err instanceof Error ? err.message : String(err));
    }
  });

  return { url, blocks, parseErrors };
}

/** Walks an arbitrary JSON-LD value (object, array, @graph) collecting every @id it finds. */
function collectIds(node: unknown, out: { id: string; type: unknown }[]): void {
  if (Array.isArray(node)) {
    for (const item of node) collectIds(item, out);
    return;
  }
  if (node && typeof node === "object") {
    const obj = node as Record<string, unknown>;
    if (typeof obj["@id"] === "string") {
      out.push({ id: obj["@id"], type: obj["@type"] });
    }
    if (Array.isArray(obj["@graph"])) collectIds(obj["@graph"], out);
    for (const [key, value] of Object.entries(obj)) {
      if (key === "@graph") continue;
      if (value && typeof value === "object") collectIds(value, out);
    }
  }
}

/** Walks for any string field named "url" (top-level entities only, not every href-like string). */
function collectUrls(node: unknown, out: string[]): void {
  if (Array.isArray(node)) {
    for (const item of node) collectUrls(item, out);
    return;
  }
  if (node && typeof node === "object") {
    const obj = node as Record<string, unknown>;
    if (typeof obj["url"] === "string") out.push(obj["url"]);
    for (const value of Object.values(obj)) {
      if (value && typeof value === "object") collectUrls(value, out);
    }
  }
}

export function checkStructuredData(pages: PageJsonLd[]): Finding[] {
  const findings: Finding[] = [];

  for (const p of pages) {
    for (const err of p.parseErrors) {
      findings.push({
        check: "structured-data",
        severity: "critical",
        message: `Malformed JSON-LD block: ${err}`,
        url: p.url,
      });
    }
  }

  // Duplicate @id across DIFFERENT pages — the FAQ-schema-bleed bug: if the
  // same @id shows up on more than one distinct page, Google's graph reads
  // them as the same entity, no matter how unrelated the pages actually are.
  //
  // Exception: some entity types are *meant* to be one singleton referenced
  // identically from every page — a site's Organization and WebSite record
  // don't change per-page, and reusing their @id everywhere is how JSON-LD
  // is supposed to work (it's what lets `publisher: {"@id": "...#org"}`
  // resolve correctly). Only page-scoped entities are a bug when shared.
  const SITE_WIDE_SINGLETON_TYPES = new Set(["Organization", "WebSite", "Person"]);

  function typesOf(type: unknown): string[] {
    if (typeof type === "string") return [type];
    if (Array.isArray(type)) return type.filter((t): t is string => typeof t === "string");
    return [];
  }

  const idToPages = new Map<string, Set<string>>();
  const idTypes = new Map<string, Set<string>>();
  for (const p of pages) {
    const ids: { id: string; type: unknown }[] = [];
    for (const block of p.blocks) collectIds(block, ids);
    for (const { id, type } of ids) {
      const set = idToPages.get(id) ?? new Set<string>();
      set.add(p.url);
      idToPages.set(id, set);

      const types = idTypes.get(id) ?? new Set<string>();
      for (const t of typesOf(type)) types.add(t);
      idTypes.set(id, types);
    }
  }
  for (const [id, urls] of idToPages) {
    if (urls.size <= 1) continue;
    const types = idTypes.get(id) ?? new Set<string>();
    const isSingleton = [...types].some((t) => SITE_WIDE_SINGLETON_TYPES.has(t));
    if (isSingleton) continue;

    findings.push({
      check: "structured-data",
      severity: "critical",
      message: `The same JSON-LD @id ("${id}"${types.size ? `, ${[...types].join("/")}` : ""}) appears on ${urls.size} different pages — they'll be read as the same entity`,
      detail: Array.from(urls).slice(0, 10).join(", "),
    });
  }

  // Structured-data urls pointing at a different host than the page itself
  // (the www-vs-apex domain mismatch bug).
  for (const p of pages) {
    const pageHost = new URL(p.url).hostname;
    const urls: string[] = [];
    for (const block of p.blocks) collectUrls(block, urls);
    const mismatched = new Set(
      urls.filter((u) => {
        try {
          return new URL(u).hostname !== pageHost;
        } catch {
          return false;
        }
      })
    );
    if (mismatched.size > 0) {
      findings.push({
        check: "structured-data",
        severity: "warning",
        message: `Structured data references a different host than this page (${pageHost})`,
        url: p.url,
        detail: Array.from(mismatched).slice(0, 5).join(", "),
      });
    }
  }

  return findings;
}
