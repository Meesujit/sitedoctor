#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { runAudit } from "./audit.js";
import { printReport, toJson } from "./report.js";
import { diffCritical } from "./notify.js";
import { parseSearchConsoleCsv, saveTraffic } from "./traffic.js";

type FailOn = "any" | "new" | "none";

interface Args {
  target: string;
  limit: number;
  redirectSamples: number;
  sitemapAttempts: number;
  json: boolean;
  out: string | null;
  notify: boolean;
  failOn: FailOn;
  suggestFixes: boolean;
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
    console.error("Usage: sitedoctor <domain> [options]");
    console.error("       sitedoctor serve [--port 4321]   (starts the web UI)");
    console.error("       sitedoctor import-traffic <domain> <path-to-search-console-csv>");
    console.error("");
    console.error("Options:");
    console.error("  --limit <n>              Max sitemap pages to check (default 40)");
    console.error("  --json / --out <file>    JSON output instead of the terminal report");
    console.error("  --notify                 Post to Discord on new critical findings or full recovery.");
    console.error("                           Requires SITEDOCTOR_DISCORD_WEBHOOK in the environment.");
    console.error("  --fail-on <any|new|none> What makes the exit code non-zero (default: any).");
    console.error("                           'new' only fails on regressions since the last scan —");
    console.error("                           the right choice for a CI gate on a site with known,");
    console.error("                           pre-existing issues you're not fixing yet.");
    console.error("  --suggest-fixes          Ask Claude for a remediation suggestion per issue category.");
    console.error("                           Requires ANTHROPIC_API_KEY in the environment.");
    process.exit(1);
  }

  const failOn = (typeof flags["fail-on"] === "string" ? flags["fail-on"] : "any") as FailOn;
  if (!["any", "new", "none"].includes(failOn)) {
    console.error(`Invalid --fail-on value: ${failOn} (expected any, new, or none)`);
    process.exit(1);
  }

  return {
    target: positional[0],
    limit: Number(flags.limit ?? 40),
    redirectSamples: Number(flags["redirect-samples"] ?? 4),
    sitemapAttempts: Number(flags["sitemap-attempts"] ?? 5),
    json: Boolean(flags.json),
    out: typeof flags.out === "string" ? flags.out : null,
    notify: Boolean(flags.notify),
    failOn,
    suggestFixes: Boolean(flags["suggest-fixes"]),
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

  if (argv[0] === "import-traffic") {
    const [, domain, csvPath] = argv;
    if (!domain || !csvPath) {
      console.error("Usage: sitedoctor import-traffic <domain> <path-to-search-console-csv>");
      console.error('Export the "Dates" tab of Search Console\'s Performance report as CSV.');
      process.exit(1);
    }
    const origin = domain.startsWith("http") ? domain.replace(/\/+$/, "") : `https://${domain}`.replace(/\/+$/, "");
    const csv = await readFile(csvPath, "utf-8");
    const points = parseSearchConsoleCsv(csv);
    await saveTraffic(origin, points);
    console.log(`Imported ${points.length} day(s) of traffic data for ${origin} (${points[0].date} to ${points[points.length - 1].date})`);
    return;
  }

  const args = parseArgs(argv);

  if (args.notify && !process.env.SITEDOCTOR_DISCORD_WEBHOOK) {
    console.error("--notify was passed but SITEDOCTOR_DISCORD_WEBHOOK isn't set in the environment. Skipping notification.");
  }
  if (args.suggestFixes && !process.env.ANTHROPIC_API_KEY) {
    console.error("--suggest-fixes was passed but ANTHROPIC_API_KEY isn't set in the environment. Skipping.");
  }

  const result = await runAudit(args.target, {
    limit: args.limit,
    redirectSamples: args.redirectSamples,
    sitemapAttempts: args.sitemapAttempts,
    onProgress: (msg) => console.error(msg),
    discordWebhook: args.notify ? process.env.SITEDOCTOR_DISCORD_WEBHOOK : undefined,
    anthropicApiKey: args.suggestFixes ? process.env.ANTHROPIC_API_KEY : undefined,
  });

  if (args.json || args.out) {
    const json = toJson(result);
    if (args.out) {
      await writeFile(args.out, json, "utf-8");
      console.error(`Wrote ${args.out}`);
    } else {
      console.log(json);
    }
  } else {
    printReport(result);
  }

  process.exitCode = shouldFail(args.failOn, result);
}

function shouldFail(failOn: FailOn, result: Awaited<ReturnType<typeof runAudit>>): number {
  if (failOn === "none") return 0;

  const criticalFindings = result.findings.filter((f) => f.severity === "critical");

  if (failOn === "any") {
    return criticalFindings.length > 0 ? 1 : 0;
  }

  // failOn === "new": only fail on critical findings that weren't present
  // in the previous scan — for a site with known, pre-existing issues
  // that aren't being fixed right now, "any" would be permanently red
  // and tell a CI pipeline nothing useful.
  const previous = result.history.length >= 2 ? result.history[result.history.length - 2] : null;
  const diff = diffCritical(criticalFindings, previous?.criticalFingerprints ?? []);
  if (diff.newCritical.length > 0) {
    console.error(`${diff.newCritical.length} new critical finding(s) since the last scan:`);
    for (const f of diff.newCritical) console.error(`  - [${f.check}] ${f.message}${f.url ? ` (${f.url})` : ""}`);
    return 1;
  }
  return 0;
}

main().catch((err) => {
  console.error("sitedoctor crashed:", err);
  process.exitCode = 2;
});
