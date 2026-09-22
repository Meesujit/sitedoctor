#!/usr/bin/env node
import { writeFile } from "node:fs/promises";
import { runAudit } from "./audit.js";
import { printReport, toJson } from "./report.js";

interface Args {
  target: string;
  limit: number;
  redirectSamples: number;
  sitemapAttempts: number;
  json: boolean;
  out: string | null;
}

function parseArgs(argv: string[]): Args {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(arg);
    }
  }

  if (positional.length === 0) {
    console.error("Usage: sitedoctor <domain> [--limit 40] [--json] [--out report.json]");
    console.error("       sitedoctor serve [--port 4321]   (starts the web UI)");
    process.exit(1);
  }

  return {
    target: positional[0],
    limit: Number(flags.limit ?? 40),
    redirectSamples: Number(flags["redirect-samples"] ?? 4),
    sitemapAttempts: Number(flags["sitemap-attempts"] ?? 5),
    json: Boolean(flags.json),
    out: typeof flags.out === "string" ? flags.out : null,
  };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);

  if (argv[0] === "serve") {
    const portFlagIndex = argv.indexOf("--port");
    const port = portFlagIndex !== -1 ? Number(argv[portFlagIndex + 1]) : undefined;
    const { startServer } = await import("./server.js");
    startServer(port);
    return;
  }

  const args = parseArgs(argv);

  const result = await runAudit(args.target, {
    limit: args.limit,
    redirectSamples: args.redirectSamples,
    sitemapAttempts: args.sitemapAttempts,
    onProgress: (msg) => console.error(msg),
  });

  if (args.json || args.out) {
    const json = toJson(result.origin, result.findings, result.warnings);
    if (args.out) {
      await writeFile(args.out, json, "utf-8");
      console.error(`Wrote ${args.out}`);
    } else {
      console.log(json);
    }
  } else {
    printReport(result.origin, result.findings, result.warnings);
  }

  const hasCritical = result.findings.some((f) => f.severity === "critical");
  process.exitCode = hasCritical ? 1 : 0;
}

main().catch((err) => {
  console.error("sitedoctor crashed:", err);
  process.exitCode = 2;
});
