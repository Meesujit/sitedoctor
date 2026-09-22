import * as cheerio from "cheerio";
import { fetchFollowing } from "../http.js";
import type { Finding } from "../types.js";

export interface PageCanonical {
  url: string;
  canonical: string | null;
}

export function extractCanonical(url: string, html: string): PageCanonical {
  const $ = cheerio.load(html);
  const href = $('link[rel="canonical"]').first().attr("href") ?? null;
  const canonical = href ? new URL(href, url).toString() : null;
  return { url, canonical };
}

/**
 * The bug we're built to catch: a layout-level default canonical (or any
 * copy-pasted value) that ends up identical across many unrelated pages,
 * telling Google they're all duplicates of one "real" page.
 */
const SHARED_CANONICAL_THRESHOLD = 3;

export async function checkCanonicals(pages: PageCanonical[]): Promise<Finding[]> {
  const findings: Finding[] = [];

  // 1. Missing canonical.
  for (const p of pages) {
    if (!p.canonical) {
      findings.push({
        check: "canonical",
        severity: "warning",
        message: "No <link rel=\"canonical\"> found",
        url: p.url,
      });
    }
  }

  // 2. Canonical shared across many distinct pages (the "everything =
  //    homepage" bug). A couple of legitimate near-duplicates (trailing
  //    slash, tracking params) sharing a canonical is normal; many
  //    unrelated pages sharing one isn't.
  const byCanonical = new Map<string, string[]>();
  for (const p of pages) {
    if (!p.canonical) continue;
    const list = byCanonical.get(p.canonical) ?? [];
    list.push(p.url);
    byCanonical.set(p.canonical, list);
  }
  for (const [canonical, urls] of byCanonical) {
    const distinctFromTarget = urls.filter((u) => u !== canonical);
    if (distinctFromTarget.length >= SHARED_CANONICAL_THRESHOLD) {
      findings.push({
        check: "canonical",
        severity: "critical",
        message: `${distinctFromTarget.length} different pages all declare the same canonical (${canonical}) — likely an inherited/copy-pasted default rather than each page's own URL`,
        url: canonical,
        detail: distinctFromTarget.slice(0, 10).join(", ") + (distinctFromTarget.length > 10 ? ", ..." : ""),
      });
    }
  }

  // 3. Cross-host canonical (e.g. page is on apex but canonical points at
  //    www, or vice versa) — a strong signal of a stale/wrong domain.
  for (const p of pages) {
    if (!p.canonical) continue;
    const pageHost = new URL(p.url).hostname;
    const canonicalHost = new URL(p.canonical).hostname;
    if (pageHost !== canonicalHost) {
      findings.push({
        check: "canonical",
        severity: "warning",
        message: `Canonical points at a different host (${canonicalHost}) than the page itself (${pageHost})`,
        url: p.url,
        detail: p.canonical,
      });
    }
  }

  // 4. Does the canonical target actually resolve cleanly (200, no further
  //    redirect)? A canonical pointing at a URL that itself redirects is a
  //    broken signal — verified by actually fetching it, not assumed.
  const uniqueCanonicals = Array.from(new Set(pages.map((p) => p.canonical).filter((c): c is string => !!c)));
  const checked = await Promise.all(
    uniqueCanonicals.map(async (canonical) => {
      const res = await fetchFollowing(canonical);
      return { canonical, res };
    })
  );
  for (const { canonical, res } of checked) {
    if (res.error) {
      findings.push({
        check: "canonical",
        severity: "critical",
        message: `Canonical target is unreachable (${res.error})`,
        url: canonical,
      });
    } else if (res.chain.length > 1) {
      findings.push({
        check: "canonical",
        severity: "critical",
        message: `Canonical points at a URL that itself redirects (${res.chain.length - 1} hop(s)) to ${res.finalUrl}`,
        url: canonical,
        detail: `used by: ${(byCanonical.get(canonical) ?? []).slice(0, 5).join(", ")}`,
      });
    } else if (res.status >= 400) {
      findings.push({
        check: "canonical",
        severity: "critical",
        message: `Canonical target returns HTTP ${res.status}`,
        url: canonical,
      });
    }
  }

  return findings;
}
