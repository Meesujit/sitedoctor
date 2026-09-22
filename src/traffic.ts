import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const TRAFFIC_DIR = path.join(process.cwd(), "data", "traffic");

export interface TrafficPoint {
  date: string; // YYYY-MM-DD
  clicks: number;
  impressions: number;
  ctr: number; // 0-1
  position: number;
}

function fileFor(origin: string): string {
  const host = origin.replace(/^https?:\/\//, "").replace(/[^a-z0-9.-]/gi, "_");
  return path.join(TRAFFIC_DIR, `${host}.json`);
}

/** Minimal CSV parser — handles quoted fields, which is all Search Console's export needs. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((f) => f.trim() !== "")) rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    if (row.some((f) => f.trim() !== "")) rows.push(row);
  }
  return rows;
}

function findCol(header: string[], names: string[]): number {
  const lower = header.map((h) => h.trim().toLowerCase());
  for (const name of names) {
    const idx = lower.indexOf(name);
    if (idx !== -1) return idx;
  }
  return -1;
}

/**
 * Parses a Google Search Console "Performance" report CSV export (the
 * Dates tab: Date, Clicks, Impressions, CTR, Position). Column names are
 * matched case-insensitively since GSC's export headers have varied
 * slightly across UI versions.
 */
export function parseSearchConsoleCsv(csv: string): TrafficPoint[] {
  const rows = parseCsv(csv);
  if (rows.length < 2) throw new Error("CSV has no data rows");

  const header = rows[0];
  const dateCol = findCol(header, ["date"]);
  const clicksCol = findCol(header, ["clicks"]);
  const impressionsCol = findCol(header, ["impressions"]);
  const ctrCol = findCol(header, ["ctr"]);
  const positionCol = findCol(header, ["position", "average position", "avg. position"]);

  if (dateCol === -1 || clicksCol === -1 || impressionsCol === -1) {
    throw new Error(
      `Couldn't find Date/Clicks/Impressions columns. Found headers: ${header.join(", ")}. Export the "Dates" tab from Search Console's Performance report.`
    );
  }

  const points: TrafficPoint[] = [];
  for (const row of rows.slice(1)) {
    const date = row[dateCol]?.trim();
    if (!date) continue;
    const clicks = Number(row[clicksCol]?.replace(/,/g, "") ?? 0);
    const impressions = Number(row[impressionsCol]?.replace(/,/g, "") ?? 0);
    const ctrRaw = ctrCol !== -1 ? row[ctrCol]?.trim() : "";
    const ctr = ctrRaw ? Number(ctrRaw.replace("%", "")) / (ctrRaw.includes("%") ? 100 : 1) : 0;
    const position = positionCol !== -1 ? Number(row[positionCol]?.trim() || 0) : 0;

    if (Number.isNaN(clicks) || Number.isNaN(impressions)) continue;
    points.push({ date, clicks, impressions, ctr, position });
  }

  if (points.length === 0) throw new Error("No valid data rows parsed from the CSV");
  return points.sort((a, b) => a.date.localeCompare(b.date));
}

export async function saveTraffic(origin: string, points: TrafficPoint[]): Promise<void> {
  await mkdir(TRAFFIC_DIR, { recursive: true });
  await writeFile(fileFor(origin), JSON.stringify(points, null, 2), "utf-8");
}

export async function getTraffic(origin: string): Promise<TrafficPoint[] | null> {
  try {
    const raw = await readFile(fileFor(origin), "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
