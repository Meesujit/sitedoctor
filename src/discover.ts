import * as cheerio from "cheerio";
import { fetchFollowing } from "./http.js";

const MAX_SITEMAPS = 20;

async function fetchSitemapUrls(sitemapUrl: string, seen: Set<string>, depth = 0): Promise<string[]> {
  if (seen.has(sitemapUrl) || depth > 3 || seen.size > MAX_SITEMAPS) return [];
  seen.add(sitemapUrl);

  const res = await fetchFollowing(sitemapUrl);
  if (res.status !== 200 || !res.body) return [];

  const $ = cheerio.load(res.body, { xmlMode: true });

  // Sitemap index: recurse into each child sitemap.
  const childSitemaps = $("sitemapindex > sitemap > loc")
    .map((_, el) => $(el).text().trim())
    .get();

  if (childSitemaps.length > 0) {
    const nested = await Promise.all(
      childSitemaps.map((loc) => fetchSitemapUrls(loc, seen, depth + 1))
    );
    return nested.flat();
  }

  // Regular urlset.
  return $("urlset > url > loc")
    .map((_, el) => $(el).text().trim())
    .get();
}

async function findSitemapsFromRobots(origin: string): Promise<string[]> {
  const res = await fetchFollowing(`${origin}/robots.txt`);
  if (res.status !== 200 || !res.body) return [];

  return res.body
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^sitemap:/i.test(line))
    .map((line) => line.replace(/^sitemap:/i, "").trim())
    .filter(Boolean);
}

export interface DiscoveryResult {
  origin: string;
  sitemapsFound: string[];
  pages: string[];
  warnings: string[];
}

/**
 * Given a domain (with or without scheme), finds its sitemap(s) via
 * robots.txt (falling back to /sitemap.xml) and returns every page URL
 * they list.
 */
export async function discover(input: string, limit?: number): Promise<DiscoveryResult> {
  const origin = input.startsWith("http") ? input.replace(/\/+$/, "") : `https://${input}`.replace(/\/+$/, "");
  const warnings: string[] = [];

  let sitemaps = await findSitemapsFromRobots(origin);
  if (sitemaps.length === 0) {
    warnings.push("No Sitemap: line in robots.txt — falling back to /sitemap.xml");
    sitemaps = [`${origin}/sitemap.xml`];
  }

  const seen = new Set<string>();
  const results = await Promise.all(sitemaps.map((s) => fetchSitemapUrls(s, seen)));
  const pages = Array.from(new Set(results.flat()));

  if (pages.length === 0) {
    warnings.push("No pages found in any sitemap. Checks below fall back to just the homepage.");
    pages.push(`${origin}/`);
  }

  return {
    origin,
    sitemapsFound: Array.from(seen),
    pages: typeof limit === "number" ? pages.slice(0, limit) : pages,
    warnings,
  };
}
