import type { Finding } from "./types.js";
import { explainCheck } from "./explanations.js";

const MODEL = "claude-haiku-4-5-20251001"; // fast/cheap — this is a short, factual remediation tip, not deep reasoning
const MAX_TOKENS = 220;
const SAMPLE_PER_GROUP = 4;

interface SuggestionResult {
  check: string;
  suggestion: string | null;
  error?: string;
}

async function suggestOne(apiKey: string, check: string, findings: Finding[]): Promise<SuggestionResult> {
  const { title, whyItMatters } = explainCheck(check);
  const sample = findings
    .slice(0, SAMPLE_PER_GROUP)
    .map((f) => `- ${f.message}${f.url ? ` (${f.url})` : ""}${f.detail ? ` — ${f.detail}` : ""}`)
    .join("\n");

  const prompt = `You're looking at a website health scan finding category called "${title}".
Context on why this category matters: ${whyItMatters}

Here are ${Math.min(findings.length, SAMPLE_PER_GROUP)} example finding(s) out of ${findings.length} total in this category:
${sample}

In 2-4 sentences, give a specific, actionable remediation suggestion a developer could act on. Be concrete about what to check or change. Do not restate the problem, just the fix. No preamble, no markdown formatting, plain text only.`;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { check, suggestion: null, error: `Anthropic API returned HTTP ${res.status}: ${body.slice(0, 200)}` };
    }

    const data = (await res.json()) as { content?: { type: string; text?: string }[] };
    const text = data.content?.find((c) => c.type === "text")?.text?.trim() ?? null;
    return { check, suggestion: text };
  } catch (err) {
    return { check, suggestion: null, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * One suggestion per check category that has findings, not per individual
 * finding — keeps this to a handful of API calls per scan regardless of
 * whether a category has 2 findings or 60 (e.g. broken links).
 */
export async function suggestFixes(
  apiKey: string,
  findingsByCheck: Map<string, Finding[]>
): Promise<Map<string, string>> {
  const entries = Array.from(findingsByCheck.entries()).filter(([, findings]) => findings.length > 0);
  const results = await Promise.all(entries.map(([check, findings]) => suggestOne(apiKey, check, findings)));

  const suggestions = new Map<string, string>();
  for (const r of results) {
    if (r.suggestion) suggestions.set(r.check, r.suggestion);
  }
  return suggestions;
}
