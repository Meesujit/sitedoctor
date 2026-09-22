import type { Finding } from "../types.js";
import type { PageSnapshot, SnapshotMap } from "../page-snapshots.js";

function truncate(s: string | null, max = 100): string {
  if (!s) return "(none)";
  return s.length > max ? s.slice(0, max) + "..." : s;
}

/**
 * Diffs this run's page snapshots against the last run's. Most changes are
 * informational — a title or canonical changing isn't inherently wrong, it
 * might be a deliberate edit, and this is about visibility ("something
 * changed, here's what") rather than judging it. Two specific transitions
 * get elevated because they're the ones that are usually accidental:
 * a page starting to error, and a page newly getting marked noindex.
 */
export function checkPageChanges(current: SnapshotMap, previous: SnapshotMap | null): Finding[] {
  if (!previous) return []; // first-ever scan of this site — nothing to diff against yet

  const findings: Finding[] = [];

  for (const [url, curr] of Object.entries(current)) {
    const prev = previous[url];
    if (!prev) continue; // new page this run — not a "change" to a known page

    if (prev.status !== curr.status) {
      const brokeIt = curr.status >= 400 && prev.status < 400;
      findings.push({
        check: "page-changes",
        severity: brokeIt ? "critical" : "info",
        message: `Status changed: ${prev.status} → ${curr.status}`,
        url,
      });
    }

    if (prev.canonical !== curr.canonical) {
      findings.push({
        check: "page-changes",
        severity: "info",
        message: "Canonical tag changed since the last scan",
        url,
        detail: `${truncate(prev.canonical)} → ${truncate(curr.canonical)}`,
      });
    }

    if (prev.title !== curr.title) {
      findings.push({
        check: "page-changes",
        severity: "info",
        message: "Title changed since the last scan",
        url,
        detail: `${truncate(prev.title)} → ${truncate(curr.title)}`,
      });
    }

    if (prev.description !== curr.description) {
      findings.push({
        check: "page-changes",
        severity: "info",
        message: "Meta description changed since the last scan",
        url,
        detail: `${truncate(prev.description)} → ${truncate(curr.description)}`,
      });
    }

    if (prev.robotsDirective !== curr.robotsDirective) {
      const newlyBlocked = !!curr.robotsDirective && !prev.robotsDirective;
      findings.push({
        check: "page-changes",
        severity: newlyBlocked ? "warning" : "info",
        message: newlyBlocked
          ? "Page was just marked noindex — confirm that's intentional"
          : "Robots directive changed since the last scan",
        url,
        detail: `${truncate(prev.robotsDirective)} → ${truncate(curr.robotsDirective)}`,
      });
    }
  }

  return findings;
}

export function buildSnapshot(
  status: number,
  canonical: string | null,
  title: string | null,
  description: string | null,
  robotsDirective: string | null
): PageSnapshot {
  return { status, canonical, title, description, robotsDirective };
}
