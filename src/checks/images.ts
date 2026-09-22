import * as cheerio from "cheerio";
import type { Finding } from "../types.js";

/**
 * Flags <img> tags with no alt attribute at all (accessibility + SEO —
 * search engines and screen readers both rely on it). We don't flag
 * `alt=""` — that's the explicit, valid way to mark an image decorative,
 * a real and common intentional choice, not a mistake.
 */
export function checkImages(url: string, html: string): Finding[] {
  const $ = cheerio.load(html);
  const findings: Finding[] = [];

  const missing = $("img")
    .filter((_, el) => $(el).attr("alt") === undefined)
    .map((_, el) => $(el).attr("src") || $(el).attr("data-src") || "(no src)")
    .get();

  if (missing.length > 0) {
    findings.push({
      check: "images",
      severity: "warning",
      message: `${missing.length} image(s) with no alt attribute at all`,
      url,
      detail: missing.slice(0, 5).join(", ") + (missing.length > 5 ? ", ..." : ""),
    });
  }

  return findings;
}
