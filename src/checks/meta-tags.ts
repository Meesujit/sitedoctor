import * as cheerio from "cheerio";
import type { Finding } from "../types.js";

export interface PageMeta {
  url: string;
  title: string | null;
  description: string | null;
}

const TITLE_MIN = 15;
const TITLE_MAX = 65;
const DESC_MIN = 50;
const DESC_MAX = 165;
const SHARED_THRESHOLD = 3; // same duplicate-bleed threshold used for canonicals

export function extractMeta(url: string, html: string): PageMeta {
  const $ = cheerio.load(html);
  const title = $("title").first().text().trim() || null;
  const description = $('meta[name="description"]').first().attr("content")?.trim() || null;
  return { url, title, description };
}

export function checkMetaTags(pages: PageMeta[]): Finding[] {
  const findings: Finding[] = [];

  for (const p of pages) {
    if (!p.title) {
      findings.push({ check: "meta-tags", severity: "critical", message: "No <title> tag", url: p.url });
    } else if (p.title.length < TITLE_MIN || p.title.length > TITLE_MAX) {
      findings.push({
        check: "meta-tags",
        severity: "info",
        message: `Title is ${p.title.length} chars (recommended ${TITLE_MIN}-${TITLE_MAX}) — search engines truncate long titles and short ones waste the space`,
        url: p.url,
        detail: p.title,
      });
    }

    if (!p.description) {
      findings.push({
        check: "meta-tags",
        severity: "warning",
        message: "No meta description — search engines will auto-generate a snippet instead of using yours",
        url: p.url,
      });
    } else if (p.description.length < DESC_MIN || p.description.length > DESC_MAX) {
      findings.push({
        check: "meta-tags",
        severity: "info",
        message: `Meta description is ${p.description.length} chars (recommended ${DESC_MIN}-${DESC_MAX})`,
        url: p.url,
        detail: p.description,
      });
    }
  }

  // Same bleed pattern as canonicals/structured-data: many distinct pages
  // sharing one title or description means they weren't actually written
  // per-page — usually an inherited default that never got overridden.
  function flagShared(field: "title" | "description", label: string) {
    const byValue = new Map<string, string[]>();
    for (const p of pages) {
      const v = p[field];
      if (!v) continue;
      const list = byValue.get(v) ?? [];
      list.push(p.url);
      byValue.set(v, list);
    }
    for (const [value, urls] of byValue) {
      if (urls.length >= SHARED_THRESHOLD) {
        findings.push({
          check: "meta-tags",
          severity: "critical",
          message: `${urls.length} different pages share the identical ${label} — looks inherited rather than written per-page`,
          detail: `"${value}" — ${urls.slice(0, 8).join(", ")}${urls.length > 8 ? ", ..." : ""}`,
        });
      }
    }
  }
  flagShared("title", "<title>");
  flagShared("description", "meta description");

  return findings;
}
