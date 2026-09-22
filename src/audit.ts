import { discover } from "./discover.js";
import { fetchFollowing } from "./http.js";
import { extractCanonical, checkCanonicals, type PageCanonical } from "./checks/canonical.js";
import { extractJsonLd, checkStructuredData, type PageJsonLd } from "./checks/structured-data.js";
import { checkRedirects } from "./checks/redirects.js";
import { checkSitemapReliability } from "./checks/sitemap-reliability.js";
import { checkFavicon } from "./checks/favicon.js";
import { computeHealthScore } from "./scoring.js";
import { recordAndGetHistory, type HistoryEntry } from "./history.js";
import type { Finding } from "./types.js";

export interface AuditOptions {
  limit?: number;
  redirectSamples?: number;
  sitemapAttempts?: number;
  /** Called with progress lines as the audit runs (e.g. to stream to a UI). */
  onProgress?: (message: string) => void;
}

export interface AuditResult {
  target: string;
  origin: string;
  pagesScanned: number;
  sitemapsFound: number;
  findings: Finding[];
  warnings: string[];
  healthScore: number;
  /** Previous runs for this origin, oldest first, including this run's entry. */
  history: HistoryEntry[];
}

const DEFAULTS = { limit: 40, redirectSamples: 4, sitemapAttempts: 5 };

/**
 * The full scan pipeline: discover pages, fetch them, run every check, and
 * return one combined result. Shared by the CLI and the web server so
 * there's exactly one place this logic lives.
 */
export async function runAudit(target: string, options: AuditOptions = {}): Promise<AuditResult> {
  const { limit, redirectSamples, sitemapAttempts } = { ...DEFAULTS, ...options };
  const progress = options.onProgress ?? (() => {});
  const findings: Finding[] = [];

  progress(`Discovering pages for ${target}...`);
  const discovery = await discover(target, limit);
  const { origin, pages, warnings, sitemapsFound } = discovery;

  progress(`Found ${pages.length} page(s) across ${sitemapsFound.length || "0 (fallback)"} sitemap(s). Fetching...`);
  const fetched = await Promise.all(pages.map((url) => fetchFollowing(url)));

  const canonicalInputs: PageCanonical[] = [];
  const jsonLdInputs: PageJsonLd[] = [];
  let homepageHtml: string | null = null;

  for (const [i, res] of fetched.entries()) {
    const url = pages[i];

    if (res.error || res.status >= 400) {
      findings.push({
        check: "fetch",
        severity: res.status === 404 ? "warning" : "critical",
        message: res.error ? `Failed to fetch: ${res.error}` : `HTTP ${res.status}`,
        url,
      });
      continue;
    }

    if (res.chain.length > 1) {
      findings.push({
        check: "fetch",
        severity: "info",
        message: `Sitemap lists a URL that redirects (${res.chain.length - 1} hop(s)) — sitemaps should list final URLs directly`,
        url,
        detail: `-> ${res.finalUrl}`,
      });
    }

    if (!res.body) continue;

    canonicalInputs.push(extractCanonical(res.finalUrl, res.body));
    jsonLdInputs.push(extractJsonLd(res.finalUrl, res.body));

    if (url.replace(/\/$/, "") === origin.replace(/\/$/, "") || url === `${origin}/`) {
      homepageHtml = res.body;
    }
  }

  progress("Running checks: canonicals, structured data, redirects, sitemap reliability, favicon...");

  const samplePaths = Array.from(
    new Set([
      "/",
      ...pages.slice(0, redirectSamples).map((u) => {
        try {
          return new URL(u).pathname;
        } catch {
          return "/";
        }
      }),
    ])
  ).slice(0, redirectSamples + 1);

  const sitemapUrl = sitemapsFound[0] ?? `${origin}/sitemap.xml`;

  const [canonicalFindings, structuredDataFindings, redirectFindings, sitemapFindings, faviconFindings] =
    await Promise.all([
      checkCanonicals(canonicalInputs),
      Promise.resolve(checkStructuredData(jsonLdInputs)),
      checkRedirects(origin, samplePaths),
      checkSitemapReliability(sitemapUrl, sitemapAttempts),
      checkFavicon(origin, homepageHtml),
    ]);

  findings.push(
    ...canonicalFindings,
    ...structuredDataFindings,
    ...redirectFindings,
    ...sitemapFindings,
    ...faviconFindings
  );

  const healthScore = computeHealthScore(findings);
  const summary = {
    critical: findings.filter((f) => f.severity === "critical").length,
    warning: findings.filter((f) => f.severity === "warning").length,
    info: findings.filter((f) => f.severity === "info").length,
  };
  const history = await recordAndGetHistory(origin, {
    timestamp: new Date().toISOString(),
    healthScore,
    pagesScanned: canonicalInputs.length,
    summary,
  });

  progress("Done.");

  return {
    target,
    origin,
    pagesScanned: canonicalInputs.length,
    sitemapsFound: sitemapsFound.length,
    findings,
    warnings,
    healthScore,
    history,
  };
}
