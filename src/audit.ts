import { discover } from "./discover.js";
import { fetchFollowing } from "./http.js";
import { extractCanonical, checkCanonicals, type PageCanonical } from "./checks/canonical.js";
import { extractJsonLd, checkStructuredData, type PageJsonLd } from "./checks/structured-data.js";
import { checkRedirects } from "./checks/redirects.js";
import { checkSitemapReliability } from "./checks/sitemap-reliability.js";
import { checkFavicon } from "./checks/favicon.js";
import { extractMeta, checkMetaTags, type PageMeta } from "./checks/meta-tags.js";
import { checkImages } from "./checks/images.js";
import { checkRobotsMeta, getRobotsDirective } from "./checks/robots-meta.js";
import { extractInternalLinks, checkBrokenLinks, type PageLinks } from "./checks/links.js";
import { checkPageChanges, buildSnapshot } from "./checks/page-changes.js";
import { getPreviousSnapshots, saveSnapshots, type SnapshotMap } from "./page-snapshots.js";
import { computeHealthScore } from "./scoring.js";
import { recordAndGetHistory, type HistoryEntry } from "./history.js";
import { fingerprint, diffCritical, notifyIfChanged } from "./notify.js";
import { suggestFixes } from "./ai-suggestions.js";
import type { Finding } from "./types.js";

export interface AuditOptions {
  limit?: number;
  redirectSamples?: number;
  sitemapAttempts?: number;
  /** Called with progress lines as the audit runs (e.g. to stream to a UI). */
  onProgress?: (message: string) => void;
  /** If set, posts to Discord on new critical findings or full recovery — never on every run. */
  discordWebhook?: string;
  /** If set, asks Claude for one remediation suggestion per issue category that has findings. */
  anthropicApiKey?: string;
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
  /** check -> suggested fix text, only populated when anthropicApiKey was set. */
  suggestedFixes: Record<string, string>;
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

  const previousSnapshots = await getPreviousSnapshots(origin);
  const currentSnapshots: SnapshotMap = {};

  progress(`Found ${pages.length} page(s) across ${sitemapsFound.length || "0 (fallback)"} sitemap(s). Fetching...`);
  const fetched = await Promise.all(pages.map((url) => fetchFollowing(url)));

  const canonicalInputs: PageCanonical[] = [];
  const jsonLdInputs: PageJsonLd[] = [];
  const metaInputs: PageMeta[] = [];
  const linkInputs: PageLinks[] = [];
  const perPageFindings: Finding[] = [];
  const fetchedUrls = new Set<string>();
  let homepageHtml: string | null = null;

  for (const [i, res] of fetched.entries()) {
    const url = pages[i];
    fetchedUrls.add(res.finalUrl);

    if (res.error || res.status >= 400) {
      findings.push({
        check: "fetch",
        severity: res.status === 404 ? "warning" : "critical",
        message: res.error ? `Failed to fetch: ${res.error}` : `HTTP ${res.status}`,
        url,
      });
      // Still snapshot the status even on failure — a page going from 200
      // to 404 between scans is exactly the kind of change this is for.
      currentSnapshots[url] = buildSnapshot(res.status, null, null, null, null);
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

    const canonicalInfo = extractCanonical(res.finalUrl, res.body);
    const metaInfo = extractMeta(res.finalUrl, res.body);
    const robotsDirective = getRobotsDirective(res.body, res);

    canonicalInputs.push(canonicalInfo);
    jsonLdInputs.push(extractJsonLd(res.finalUrl, res.body));
    metaInputs.push(metaInfo);
    linkInputs.push(extractInternalLinks(res.finalUrl, res.body, origin));
    perPageFindings.push(...checkImages(res.finalUrl, res.body));
    perPageFindings.push(...checkRobotsMeta(res.finalUrl, res.body, res));

    currentSnapshots[url] = buildSnapshot(
      res.status,
      canonicalInfo.canonical,
      metaInfo.title,
      metaInfo.description,
      robotsDirective
    );

    if (url.replace(/\/$/, "") === origin.replace(/\/$/, "") || url === `${origin}/`) {
      homepageHtml = res.body;
    }
  }

  const pageChangeFindings = checkPageChanges(currentSnapshots, previousSnapshots);
  findings.push(...pageChangeFindings);
  await saveSnapshots(origin, currentSnapshots);

  progress(
    "Running checks: canonicals, structured data, redirects, sitemap reliability, favicon, meta tags, links..."
  );

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

  const [
    canonicalFindings,
    structuredDataFindings,
    redirectFindings,
    sitemapFindings,
    faviconFindings,
    metaFindings,
    linkFindings,
  ] = await Promise.all([
    checkCanonicals(canonicalInputs),
    Promise.resolve(checkStructuredData(jsonLdInputs)),
    checkRedirects(origin, samplePaths),
    checkSitemapReliability(sitemapUrl, sitemapAttempts),
    checkFavicon(origin, homepageHtml),
    Promise.resolve(checkMetaTags(metaInputs)),
    checkBrokenLinks(linkInputs, fetchedUrls),
  ]);

  findings.push(
    ...canonicalFindings,
    ...structuredDataFindings,
    ...redirectFindings,
    ...sitemapFindings,
    ...faviconFindings,
    ...metaFindings,
    ...linkFindings,
    ...perPageFindings
  );

  const healthScore = computeHealthScore(findings);
  const criticalFindings = findings.filter((f) => f.severity === "critical");
  const summary = {
    critical: criticalFindings.length,
    warning: findings.filter((f) => f.severity === "warning").length,
    info: findings.filter((f) => f.severity === "info").length,
  };

  const history = await recordAndGetHistory(origin, {
    timestamp: new Date().toISOString(),
    healthScore,
    pagesScanned: canonicalInputs.length,
    summary,
    criticalFingerprints: criticalFindings.map(fingerprint),
  });

  if (options.discordWebhook) {
    const previous = history.length >= 2 ? history[history.length - 2] : null;
    const diff = diffCritical(criticalFindings, previous?.criticalFingerprints ?? []);
    const result = await notifyIfChanged(options.discordWebhook, origin, healthScore, criticalFindings, diff);
    if (result.error) progress(`Discord notification failed: ${result.error}`);
    else if (result.posted) progress("Posted a Discord update (state changed).");
  }

  let suggestedFixes: Record<string, string> = {};
  if (options.anthropicApiKey && findings.length > 0) {
    progress("Asking Claude for remediation suggestions...");
    const byCheck = new Map<string, Finding[]>();
    for (const f of findings) {
      const list = byCheck.get(f.check) ?? [];
      list.push(f);
      byCheck.set(f.check, list);
    }
    const suggestions = await suggestFixes(options.anthropicApiKey, byCheck);
    suggestedFixes = Object.fromEntries(suggestions);
  }

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
    suggestedFixes,
  };
}
