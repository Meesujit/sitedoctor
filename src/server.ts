import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { runAudit } from "./audit.js";
import { toJson } from "./report.js";
import { parseSearchConsoleCsv, saveTraffic, getTraffic } from "./traffic.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// In dev (tsx) this file runs from src/, in prod (build) from dist/ — the
// frontend HTML lives one level up from both, at the project root.
const INDEX_HTML_PATH = path.join(__dirname, "..", "public", "index.html");

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf-8");
}

function sendJson(res: ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(body);
}

async function handleScan(req: IncomingMessage, res: ServerResponse): Promise<void> {
  let payload: {
    domain?: string;
    limit?: number;
    redirectSamples?: number;
    sitemapAttempts?: number;
    suggestFixes?: boolean;
  };
  try {
    payload = JSON.parse(await readBody(req));
  } catch {
    sendJson(res, 400, { error: "Invalid JSON body" });
    return;
  }

  const domain = payload.domain?.trim();
  if (!domain) {
    sendJson(res, 400, { error: "Missing 'domain'" });
    return;
  }

  try {
    const result = await runAudit(domain, {
      limit: payload.limit,
      redirectSamples: payload.redirectSamples,
      sitemapAttempts: payload.sitemapAttempts,
      // Both read from the server's own environment, never from the request
      // body — a webhook URL and an API key aren't something a client
      // should get to set. The client can only opt IN to using the key
      // that's already configured server-side, via suggestFixes: true.
      discordWebhook: process.env.SITEDOCTOR_DISCORD_WEBHOOK,
      anthropicApiKey: payload.suggestFixes ? process.env.ANTHROPIC_API_KEY : undefined,
    });
    const traffic = await getTraffic(result.origin);
    sendJson(res, 200, { ...JSON.parse(toJson(result)), traffic });
  } catch (err) {
    sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
  }
}

async function handleImportTraffic(req: IncomingMessage, res: ServerResponse): Promise<void> {
  let payload: { domain?: string; csv?: string };
  try {
    payload = JSON.parse(await readBody(req));
  } catch {
    sendJson(res, 400, { error: "Invalid JSON body" });
    return;
  }

  const domain = payload.domain?.trim();
  if (!domain || !payload.csv) {
    sendJson(res, 400, { error: "Missing 'domain' or 'csv'" });
    return;
  }

  const origin = domain.startsWith("http") ? domain.replace(/\/+$/, "") : `https://${domain}`.replace(/\/+$/, "");

  try {
    const points = parseSearchConsoleCsv(payload.csv);
    await saveTraffic(origin, points);
    sendJson(res, 200, { imported: points.length, from: points[0].date, to: points[points.length - 1].date });
  } catch (err) {
    sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
  }
}

export function startServer(port = 4321): void {
  const server = createServer(async (req, res) => {
    try {
      if (req.method === "GET" && (req.url === "/" || req.url === "/index.html")) {
        const html = await readFile(INDEX_HTML_PATH, "utf-8");
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(html);
        return;
      }

      if (req.method === "POST" && req.url === "/api/scan") {
        await handleScan(req, res);
        return;
      }

      if (req.method === "POST" && req.url === "/api/import-traffic") {
        await handleImportTraffic(req, res);
        return;
      }

      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not found");
    } catch (err) {
      sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
    }
  });

  server.listen(port, () => {
    console.log(`sitedoctor web UI: http://localhost:${port}`);
  });
}
