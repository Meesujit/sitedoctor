import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const SNAPSHOT_DIR = path.join(process.cwd(), "data", "snapshots");

export interface PageSnapshot {
  canonical: string | null;
  title: string | null;
  description: string | null;
  /** Combined meta-robots + X-Robots-Tag content, or null if neither is set. */
  robotsDirective: string | null;
  status: number;
}

export type SnapshotMap = Record<string, PageSnapshot>;

function fileFor(origin: string): string {
  const host = origin.replace(/^https?:\/\//, "").replace(/[^a-z0-9.-]/gi, "_");
  return path.join(SNAPSHOT_DIR, `${host}.json`);
}

/** Returns null (not {}) on a first-ever scan, so callers can skip diffing
 *  entirely rather than reporting every page as "new". */
export async function getPreviousSnapshots(origin: string): Promise<SnapshotMap | null> {
  try {
    const raw = await readFile(fileFor(origin), "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function saveSnapshots(origin: string, snapshots: SnapshotMap): Promise<void> {
  await mkdir(SNAPSHOT_DIR, { recursive: true });
  await writeFile(fileFor(origin), JSON.stringify(snapshots, null, 2), "utf-8");
}
