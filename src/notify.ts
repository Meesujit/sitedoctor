import type { Finding } from "./types.js";

/** A stable-ish identifier for a finding, used to diff "seen before" across runs. */
export function fingerprint(f: Finding): string {
  return `${f.check}|${f.url ?? ""}|${f.message}`;
}

interface DiffResult {
  newCritical: Finding[];
  resolvedCount: number;
}

export function diffCritical(currentCritical: Finding[], previousFingerprints: string[]): DiffResult {
  const prevSet = new Set(previousFingerprints);
  const currentSet = new Set(currentCritical.map(fingerprint));

  const newCritical = currentCritical.filter((f) => !prevSet.has(fingerprint(f)));
  const resolvedCount = previousFingerprints.filter((fp) => !currentSet.has(fp)).length;

  return { newCritical, resolvedCount };
}

/**
 * Posts to Discord only on a state change — new critical findings
 * appearing, or the site going fully clean after having had critical
 * findings. Same lesson as the HRMS/quiz monitors: alert on change, not
 * on every run, or the channel becomes noise nobody reads.
 */
export async function notifyIfChanged(
  webhookUrl: string,
  origin: string,
  healthScore: number,
  currentCritical: Finding[],
  diff: DiffResult
): Promise<{ posted: boolean; error?: string }> {
  let content: string | null = null;

  if (diff.newCritical.length > 0) {
    const lines = diff.newCritical
      .slice(0, 8)
      .map((f) => `• **${f.check}**: ${f.message}${f.url ? ` (${f.url})` : ""}`)
      .join("\n");
    const more = diff.newCritical.length > 8 ? `\n...and ${diff.newCritical.length - 8} more` : "";
    content = `🚨 **sitedoctor** — ${diff.newCritical.length} new critical issue(s) on ${origin} (health score ${healthScore}/100)\n${lines}${more}`;
  } else if (diff.resolvedCount > 0 && currentCritical.length === 0) {
    content = `✅ **sitedoctor** — all critical issues resolved on ${origin} (health score ${healthScore}/100)`;
  }

  if (!content) return { posted: false };

  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });
    if (!res.ok) return { posted: false, error: `Discord returned HTTP ${res.status}` };
    return { posted: true };
  } catch (err) {
    return { posted: false, error: err instanceof Error ? err.message : String(err) };
  }
}
