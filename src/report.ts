import pc from "picocolors";
import type { Finding, Severity } from "./types.js";
import type { AuditResult } from "./audit.js";
import { explainCheck } from "./explanations.js";
import { scoreLabel } from "./scoring.js";

const SEVERITY_ORDER: Severity[] = ["critical", "warning", "info"];

const SEVERITY_STYLE: Record<Severity, (s: string) => string> = {
  critical: (s) => pc.bold(pc.red(s)),
  warning: (s) => pc.yellow(s),
  info: (s) => pc.cyan(s),
};

const SEVERITY_LABEL: Record<Severity, string> = {
  critical: "CRITICAL",
  warning: "WARNING",
  info: "INFO",
};

export function printReport(result: AuditResult): void {
  const { origin: target, findings, warnings, healthScore, history, suggestedFixes } = result;
  console.log();
  console.log(pc.bold(`sitedoctor report — ${target}`));
  console.log(pc.dim(new Date().toISOString()));

  const prev = history.length >= 2 ? history[history.length - 2] : null;
  const delta = prev ? healthScore - prev.healthScore : null;
  const deltaStr =
    delta === null ? "(first scan)" : delta === 0 ? "(no change)" : delta > 0 ? `(+${delta})` : `(${delta})`;
  const scoreColor = healthScore >= 90 ? pc.green : healthScore >= 70 ? pc.yellow : pc.red;
  console.log(scoreColor(pc.bold(`Health score: ${healthScore}/100 — ${scoreLabel(healthScore)} ${deltaStr}`)));
  console.log();

  for (const w of warnings) {
    console.log(pc.dim(`  note: ${w}`));
  }
  if (warnings.length > 0) console.log();

  if (findings.length === 0) {
    console.log(pc.green("  No issues found. 🎉"));
    console.log();
    return;
  }

  const byCheck = new Map<string, Finding[]>();
  for (const f of findings) {
    const list = byCheck.get(f.check) ?? [];
    list.push(f);
    byCheck.set(f.check, list);
  }

  for (const [check, checkFindings] of byCheck) {
    const { title, whyItMatters } = explainCheck(check);
    console.log(pc.bold(pc.underline(title)));
    if (whyItMatters) console.log(pc.dim(`  ${whyItMatters}`));
    const sorted = [...checkFindings].sort(
      (a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity)
    );
    for (const f of sorted) {
      const style = SEVERITY_STYLE[f.severity];
      console.log(`  ${style(`[${SEVERITY_LABEL[f.severity]}]`)} ${f.message}`);
      if (f.url) console.log(pc.dim(`      ${f.url}`));
      if (f.detail) console.log(pc.dim(`      ${f.detail}`));
    }
    const suggestion = suggestedFixes?.[check];
    if (suggestion) {
      console.log(pc.cyan(`  💡 ${suggestion}`));
    }
    console.log();
  }

  const counts = { critical: 0, warning: 0, info: 0 };
  for (const f of findings) counts[f.severity]++;
  console.log(
    pc.bold("Summary: ") +
      SEVERITY_STYLE.critical(`${counts.critical} critical`) +
      ", " +
      SEVERITY_STYLE.warning(`${counts.warning} warning`) +
      ", " +
      SEVERITY_STYLE.info(`${counts.info} info`)
  );
  console.log();
}

export function toJson(result: AuditResult): string {
  const { origin: target, findings, warnings, healthScore, history, pagesScanned, sitemapsFound, suggestedFixes } =
    result;
  const byCheck = new Map<string, Finding[]>();
  for (const f of findings) {
    const list = byCheck.get(f.check) ?? [];
    list.push(f);
    byCheck.set(f.check, list);
  }
  const groups = Array.from(byCheck.entries()).map(([check, checkFindings]) => ({
    check,
    ...explainCheck(check),
    findings: checkFindings,
    suggestedFix: suggestedFixes?.[check] ?? null,
  }));

  const prev = history.length >= 2 ? history[history.length - 2] : null;

  return JSON.stringify(
    {
      target,
      generatedAt: new Date().toISOString(),
      warnings,
      findings,
      groups,
      healthScore,
      healthScoreLabel: scoreLabel(healthScore),
      healthScoreDelta: prev ? healthScore - prev.healthScore : null,
      history,
      pagesScanned,
      sitemapsFound,
      summary: {
        critical: findings.filter((f) => f.severity === "critical").length,
        warning: findings.filter((f) => f.severity === "warning").length,
        info: findings.filter((f) => f.severity === "info").length,
      },
    },
    null,
    2
  );
}
