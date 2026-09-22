import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const HISTORY_DIR = path.join(process.cwd(), "data", "history");
const MAX_ENTRIES = 200;

export interface HistoryEntry {
  timestamp: string; // ISO
  healthScore: number;
  pagesScanned: number;
  summary: { critical: number; warning: number; info: number };
  /** Stable identifiers for critical findings, so the next run can diff
   *  "what's new" / "what's resolved" without storing every full finding. */
  criticalFingerprints: string[];
}

function fileFor(origin: string): string {
  const host = origin.replace(/^https?:\/\//, "").replace(/[^a-z0-9.-]/gi, "_");
  return path.join(HISTORY_DIR, `${host}.json`);
}

async function readHistory(origin: string): Promise<HistoryEntry[]> {
  try {
    const raw = await readFile(fileFor(origin), "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Appends a new entry and returns the full (trimmed) history, newest last. */
export async function recordAndGetHistory(origin: string, entry: HistoryEntry): Promise<HistoryEntry[]> {
  await mkdir(HISTORY_DIR, { recursive: true });
  const existing = await readHistory(origin);
  const updated = [...existing, entry].slice(-MAX_ENTRIES);
  await writeFile(fileFor(origin), JSON.stringify(updated, null, 2), "utf-8");
  return updated;
}

export async function getHistory(origin: string): Promise<HistoryEntry[]> {
  return readHistory(origin);
}
