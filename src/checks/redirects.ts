import { fetchFollowing } from "../http.js";
import type { Finding } from "../types.js";

function hostVariants(origin: string): { apex: string; www: string } {
  const u = new URL(origin);
  const isWww = u.hostname.startsWith("www.");
  const apexHost = isWww ? u.hostname.slice(4) : u.hostname;
  return { apex: apexHost, www: `www.${apexHost}` };
}

/**
 * For a sample of paths, tests all four (protocol x host) combinations and
 * checks they all converge on one single, consistent, single-hop final URL.
 * Catches: a host or protocol variant that doesn't redirect at all, redirects
 * to the wrong place, or takes more hops than necessary.
 */
export async function checkRedirects(origin: string, samplePaths: string[]): Promise<Finding[]> {
  const findings: Finding[] = [];
  const { apex, www } = hostVariants(origin);
  const preferredHost = new URL(origin).hostname;

  for (const path of samplePaths) {
    const variants = [
      `http://${apex}${path}`,
      `https://${apex}${path}`,
      `http://${www}${path}`,
      `https://${www}${path}`,
    ];

    const results = await Promise.all(variants.map((v) => fetchFollowing(v)));
    const finals = new Set(results.map((r) => r.finalUrl));

    for (const [i, res] of results.entries()) {
      if (res.error) {
        findings.push({
          check: "redirects",
          severity: "critical",
          message: `${variants[i]} failed to resolve (${res.error})`,
          url: variants[i],
        });
        continue;
      }
      if (res.status >= 400) {
        findings.push({
          check: "redirects",
          severity: "critical",
          message: `${variants[i]} ends in HTTP ${res.status} instead of reaching the site`,
          url: variants[i],
        });
        continue;
      }
      const finalHost = new URL(res.finalUrl).hostname;
      const finalProtocol = new URL(res.finalUrl).protocol;
      if (finalHost !== preferredHost || finalProtocol !== "https:") {
        findings.push({
          check: "redirects",
          severity: "warning",
          message: `${variants[i]} lands on ${res.finalUrl}, not the canonical https://${preferredHost}`,
          url: variants[i],
        });
      }
      if (res.chain.length > 2) {
        findings.push({
          check: "redirects",
          severity: "warning",
          message: `${variants[i]} takes ${res.chain.length - 1} redirect hops to resolve — more than the usual 1`,
          url: variants[i],
          detail: res.chain.join(" -> "),
        });
      }
    }

    if (finals.size > 1) {
      findings.push({
        check: "redirects",
        severity: "critical",
        message: `The four host/protocol variants of ${path} don't all land on the same URL`,
        detail: Array.from(finals).join(", "),
      });
    }
  }

  return findings;
}
