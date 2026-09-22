import pc from "picocolors";
import type { Finding, Severity } from "./types.js";

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

export function printReport(target: string, findings: Finding[], warnings: string[]): void {
  console.log();
  console.log(pc.bold(`sitedoctor report — ${target}`));
  console.log(pc.dim(new Date().toISOString()));
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
    console.log(pc.bold(pc.underline(check)));
    const sorted = [...checkFindings].sort(
      (a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity)
    );
    for (const f of sorted) {
      const style = SEVERITY_STYLE[f.severity];
      console.log(`  ${style(`[${SEVERITY_LABEL[f.severity]}]`)} ${f.message}`);
      if (f.url) console.log(pc.dim(`      ${f.url}`));
      if (f.detail) console.log(pc.dim(`      ${f.detail}`));
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

export function toJson(target: string, findings: Finding[], warnings: string[]): string {
  return JSON.stringify(
    {
      target,
      generatedAt: new Date().toISOString(),
      warnings,
      findings,
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
