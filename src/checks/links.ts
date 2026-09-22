import * as cheerio from "cheerio";
import { fetchFollowing } from "../http.js";
import type { Finding } from "../types.js";

const MAX_NEW_LINKS_CHECKED = 60;
const CONCURRENCY = 8;

export interface PageLinks {
  url: string;
  internalLinks: string[];
}

/** Extracts same-origin <a href> targets, resolved to absolute URLs, hash/query-stripped for dedup. */
export function extractInternalLinks(url: string, html: string, origin: string): PageLinks {
  const $ = cheerio.load(html);
  const originHost = new URL(origin).hostname;
  const links = new Set<string>();

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href || href.startsWith("mailto:") || href.startsWith("tel:") || href.startsWith("javascript:")) return;
    try {
      const resolved = new URL(href, url);
      if (resolved.hostname !== originHost) return;
      resolved.hash = "";
      links.add(resolved.toString());
    } catch {
      // Malformed href — ignore rather than crash the scan over one bad link.
    }
  });

  return { url, internalLinks: Array.from(links) };
}

async function fetchInBatches<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += size) {
    const batch = items.slice(i, i + size);
    results.push(...(await Promise.all(batch.map(fn))));
  }
  return results;
}

/**
 * Checks internal links found on the scanned pages that weren't already
 * fetched as part of the sitemap crawl — the links a visitor would
 * actually click that the sitemap doesn't necessarily list.
 */
export async function checkBrokenLinks(pages: PageLinks[], alreadyFetched: Set<string>): Promise<Finding[]> {
  const linkedBy = new Map<string, string[]>();
  for (const p of pages) {
    for (const link of p.internalLinks) {
      if (alreadyFetched.has(link)) continue;
      const list = linkedBy.get(link) ?? [];
      list.push(p.url);
      linkedBy.set(link, list);
    }
  }

  const toCheck = Array.from(linkedBy.keys()).slice(0, MAX_NEW_LINKS_CHECKED);
  const findings: Finding[] = [];

  const results = await fetchInBatches(toCheck, CONCURRENCY, async (link) => ({
    link,
    res: await fetchFollowing(link),
  }));

  for (const { link, res } of results) {
    const linkedFrom = linkedBy.get(link) ?? [];
    if (res.error) {
      findings.push({
        check: "links",
        severity: "critical",
        message: `Broken link: ${res.error}`,
        url: link,
        detail: `linked from: ${linkedFrom.slice(0, 3).join(", ")}${linkedFrom.length > 3 ? ", ..." : ""}`,
      });
    } else if (res.status >= 400) {
      findings.push({
        check: "links",
        severity: res.status === 404 ? "warning" : "critical",
        message: `Broken link: HTTP ${res.status}`,
        url: link,
        detail: `linked from: ${linkedFrom.slice(0, 3).join(", ")}${linkedFrom.length > 3 ? ", ..." : ""}`,
      });
    }
  }

  if (linkedBy.size > MAX_NEW_LINKS_CHECKED) {
    findings.push({
      check: "links",
      severity: "info",
      message: `Found ${linkedBy.size} internal links beyond the sitemap; only checked the first ${MAX_NEW_LINKS_CHECKED} to keep scan time reasonable`,
    });
  }

  return findings;
}
