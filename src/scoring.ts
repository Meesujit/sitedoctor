import type { Finding, Severity } from "./types.js";

/**
 * Points deducted per finding, by severity. A weighted deduction rather
 * than a pass/fail count, so the score is a rough "how bad is it" signal —
 * reportable as a trend, not just a raw findings list.
 */
const PENALTY: Record<Severity, number> = {
  critical: 8,
  warning: 3,
  info: 0.5,
};

export function computeHealthScore(findings: Finding[]): number {
  const deduction = findings.reduce((sum, f) => sum + PENALTY[f.severity], 0);
  return Math.max(0, Math.min(100, Math.round(100 - deduction)));
}

export function scoreLabel(score: number): string {
  if (score >= 90) return "Healthy";
  if (score >= 70) return "Needs attention";
  if (score >= 40) return "At risk";
  return "Critical";
}
