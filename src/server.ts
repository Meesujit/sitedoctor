import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { runAudit } from "./audit.js";
import { toJson } from "./report.js";

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
  let payload: { domain?: string; limit?: number; redirectSamples?: number; sitemapAttempts?: number };
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
    });
    sendJson(res, 200, JSON.parse(toJson(result)));
  } catch (err) {
    sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
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
