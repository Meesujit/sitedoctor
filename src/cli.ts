#!/usr/bin/env node
import { writeFile } from "node:fs/promises";
import { discover } from "./discover.js";
import { fetchFollowing } from "./http.js";
import { extractCanonical, checkCanonicals, type PageCanonical } from "./checks/canonical.js";
import { extractJsonLd, checkStructuredData, type PageJsonLd } from "./checks/structured-data.js";
import { checkRedirects } from "./checks/redirects.js";
import { checkSitemapReliability } from "./checks/sitemap-reliability.js";
import { checkFavicon } from "./checks/favicon.js";
import { printReport, toJson } from "./report.js";
import type { Finding } from "./types.js";

interface Args {
  target: string;
  limit: number;
  redirectSamples: number;
  sitemapAttempts: number;
  json: boolean;
  out: string | null;
}

function parseArgs(argv: string[]): Args {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(arg);
    }
  }

  if (positional.length === 0) {
    console.error("Usage: sitedoctor <domain> [--limit 40] [--json] [--out report.json]");
    process.exit(1);
  }

  return {
    target: positional[0],
    limit: Number(flags.limit ?? 40),
    redirectSamples: Number(flags["redirect-samples"] ?? 4),
    sitemapAttempts: Number(flags["sitemap-attempts"] ?? 5),
    json: Boolean(flags.json),
    out: typeof flags.out === "string" ? flags.out : null,
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const findings: Finding[] = [];

  console.error(`Discovering pages for ${args.target}...`);
  const discovery = await discover(args.target, args.limit);
  const { origin, pages, warnings, sitemapsFound } = discovery;

  console.error(`Found ${pages.length} page(s) across ${sitemapsFound.length || "0 (fallback)"} sitemap(s). Fetching...`);

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

  console.error("Running checks: canonicals, structured data, redirects, sitemap reliability, favicon...");

  const samplePaths = Array.from(
    new Set([
      "/",
      ...pages.slice(0, args.redirectSamples).map((u) => {
        try {
          return new URL(u).pathname;
        } catch {
          return "/";
        }
      }),
    ])
  ).slice(0, args.redirectSamples + 1);

  const sitemapUrl = sitemapsFound[0] ?? `${origin}/sitemap.xml`;

  const [canonicalFindings, structuredDataFindings, redirectFindings, sitemapFindings, faviconFindings] =
    await Promise.all([
      checkCanonicals(canonicalInputs),
      Promise.resolve(checkStructuredData(jsonLdInputs)),
      checkRedirects(origin, samplePaths),
      checkSitemapReliability(sitemapUrl, args.sitemapAttempts),
      checkFavicon(origin, homepageHtml),
    ]);

  findings.push(
    ...canonicalFindings,
    ...structuredDataFindings,
    ...redirectFindings,
    ...sitemapFindings,
    ...faviconFindings
  );

  const allWarnings = [...warnings];

  if (args.json || args.out) {
    const json = toJson(origin, findings, allWarnings);
    if (args.out) {
      await writeFile(args.out, json, "utf-8");
      console.error(`Wrote ${args.out}`);
    } else {
      console.log(json);
    }
  } else {
    printReport(origin, findings, allWarnings);
  }

  const hasCritical = findings.some((f) => f.severity === "critical");
  process.exitCode = hasCritical ? 1 : 0;
}

main().catch((err) => {
  console.error("sitedoctor crashed:", err);
  process.exitCode = 2;
});
