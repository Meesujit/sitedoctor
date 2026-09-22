import * as cheerio from "cheerio";
import type { Finding } from "../types.js";
import type { FetchResult } from "../http.js";

const BLOCKING_DIRECTIVES = ["noindex", "none"];

/** The combined meta-robots + X-Robots-Tag content for a page, or null if neither is set. */
export function getRobotsDirective(html: string, res: FetchResult): string | null {
  const $ = cheerio.load(html);
  const metaContent = $('meta[name="robots"]').first().attr("content")?.toLowerCase() ?? "";
  const headerContent = (res.headers.get("x-robots-tag") ?? "").toLowerCase();
  const combined = [metaContent, headerContent].filter(Boolean).join(" / ");
  return combined || null;
}

export function directiveBlocksIndexing(directive: string | null): boolean {
  if (!directive) return false;
  return BLOCKING_DIRECTIVES.some((d) => directive.includes(d));
}

/**
 * A page can be told not to index it two ways: a <meta name="robots"> tag
 * or an X-Robots-Tag response header. Either is often intentional (a
 * thank-you page, an internal tool) — this doesn't assume it's a mistake,
 * it surfaces it so a human confirms that's what was meant, since a page
 * that's IN the sitemap but marked noindex is a contradiction worth a look.
 */
export function checkRobotsMeta(url: string, html: string, res: FetchResult): Finding[] {
  const findings: Finding[] = [];
  const $ = cheerio.load(html);

  const metaContent = $('meta[name="robots"]').first().attr("content")?.toLowerCase() ?? "";
  const headerContent = (res.headers.get("x-robots-tag") ?? "").toLowerCase();

  const metaBlocks = BLOCKING_DIRECTIVES.some((d) => metaContent.includes(d));
  const headerBlocks = BLOCKING_DIRECTIVES.some((d) => headerContent.includes(d));

  if (metaBlocks || headerBlocks) {
    findings.push({
      check: "robots-meta",
      severity: "warning",
      message: `Page is marked noindex (${metaBlocks ? "meta tag" : ""}${metaBlocks && headerBlocks ? " + " : ""}${
        headerBlocks ? "X-Robots-Tag header" : ""
      }) but is listed in the sitemap — confirm that's intentional`,
      url,
      detail: [metaContent, headerContent].filter(Boolean).join(" / "),
    });
  }

  return findings;
}
