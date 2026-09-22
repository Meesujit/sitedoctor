import * as cheerio from "cheerio";
import { fetchFollowing } from "../http.js";
import type { Finding } from "../types.js";

const DEFAULT_ATTEMPTS = 5;
const DELAY_MS = 4_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchUrlSet(sitemapUrl: string): Promise<Set<string> | null> {
  const res = await fetchFollowing(sitemapUrl);
  if (res.status !== 200 || !res.body) return null;
  const $ = cheerio.load(res.body, { xmlMode: true });
  const urls = $("url > loc, sitemap > loc")
    .map((_, el) => $(el).text().trim())
    .get();
  return new Set(urls);
}

/**
 * Re-fetches the sitemap several times, spaced out, and flags instability.
 * Generic crawlers fetch a sitemap once and trust it; the bug this catches
 * only shows up on a second look — a background regeneration that
 * intermittently produces a truncated result (e.g. an upstream API call
 * inside the sitemap route timing out) gets cached and served consistently
 * wrong until the next regeneration happens to succeed.
 */
export async function checkSitemapReliability(
  sitemapUrl: string,
  attempts = DEFAULT_ATTEMPTS
): Promise<Finding[]> {
  const findings: Finding[] = [];
  const snapshots: (Set<string> | null)[] = [];

  for (let i = 0; i < attempts; i++) {
    snapshots.push(await fetchUrlSet(sitemapUrl));
    if (i < attempts - 1) await sleep(DELAY_MS);
  }

  const failed = snapshots.filter((s) => s === null).length;
  if (failed > 0) {
    findings.push({
      check: "sitemap-reliability",
      severity: failed === attempts ? "critical" : "warning",
      message: `Sitemap failed to fetch on ${failed}/${attempts} attempts`,
      url: sitemapUrl,
    });
  }

  const validSnapshots = snapshots.filter((s): s is Set<string> => s !== null);
  if (validSnapshots.length < 2) return findings;

  const counts = validSnapshots.map((s) => s.size);
  const minCount = Math.min(...counts);
  const maxCount = Math.max(...counts);

  if (minCount !== maxCount) {
    // Find what disappeared between the smallest and largest snapshot, so
    // the report names actual URLs instead of just "counts differ".
    const largest = validSnapshots.find((s) => s.size === maxCount)!;
    const smallest = validSnapshots.find((s) => s.size === minCount)!;
    const missing = Array.from(largest).filter((u) => !smallest.has(u));

    findings.push({
      check: "sitemap-reliability",
      severity: "critical",
      message: `Sitemap URL count is unstable across ${attempts} fetches (${minCount}-${maxCount} URLs) — some fetches are silently missing entries`,
      url: sitemapUrl,
      detail:
        missing.length > 0
          ? `e.g. missing in a smaller fetch: ${missing.slice(0, 5).join(", ")}${missing.length > 5 ? ", ..." : ""}`
          : undefined,
    });
  }

  return findings;
}
