# sitedoctor

A CLI that catches the site-health bugs generic SEO crawlers miss — because
they only look once. `sitedoctor` was built the same night it found (and we
fixed) five real bugs on a live production site: canonical tags that
inherited a layout default instead of pointing at themselves, a structured-data
domain mismatch, a sitemap that silently dropped blog posts under load, a
`favicon.ico` that was actually an SVG saved under the wrong extension, and an
`FAQPage` schema block reused verbatim across unrelated pages.

None of those show up on a single pass. That's the point.

## What it checks

- **Canonical tags** — missing, identical across many unrelated pages (the
  "everything inherited the homepage's canonical" bug), pointing at a host
  that doesn't match the page, or pointing at a URL that itself redirects.
- **www / apex / http / https redirects** — samples several paths across all
  four host+protocol combinations and checks they all converge on one
  consistent URL in a single hop.
- **Structured data (JSON-LD)** — malformed blocks, and an `@id` reused
  across genuinely different pages (excluding legitimate site-wide
  singletons like `Organization`/`WebSite`, which are *supposed* to share
  one `@id`).
- **Sitemap reliability** — re-fetches the sitemap several times, spaced
  out, and flags instability. A single fetch can't catch a background
  regeneration that intermittently drops entries under load; this can.
- **Favicon validity** — reads the actual bytes and compares them to what
  the extension claims, instead of trusting the filename.
- **Titles & meta descriptions** — missing, too long/short, or identical
  across many pages (the same inheritance-bleed bug as canonicals, just for
  the tags that actually show up as your search result snippet).
- **Image alt text** — `<img>` tags with no `alt` attribute at all (not the
  same as an intentionally empty `alt=""` on a decorative image).
- **Accidental noindex** — a page listed in the sitemap that's also marked
  `noindex` via meta tag or `X-Robots-Tag` header, which is usually one of
  the two being set by mistake.
- **Broken internal links** — links an actual visitor would click, crawled
  from the pages themselves rather than just the sitemap (capped at 60 new
  links per scan to keep runtime reasonable).
- **Changes since last scan** — every scan snapshots each page's status,
  canonical, title, description, and robots directive, then diffs against
  the last snapshot (stored in `data/snapshots/`, gitignored). Most changes
  are informational (a title changing isn't inherently wrong), but a page
  newly erroring or newly getting marked noindex is elevated to a real
  finding — this is the closest thing here to what enterprise "continuous
  monitoring" tools charge for, and it flows through the same scoring,
  history, and Discord alerting as every other check for free.

## Alerting

Set `SITEDOCTOR_DISCORD_WEBHOOK` in the environment and pass `--notify`
(CLI) or just run `serve` (the server always notifies if the env var is
set) to post to Discord — but only on a **state change**: new critical
findings appearing, or the site going fully clean after having had
critical findings. It won't repost the same standing issues every run;
that's how alert channels turn into noise nobody reads.

## CI gate

```bash
sitedoctor <domain> --fail-on new    # exit 1 only on regressions since the last scan
sitedoctor <domain> --fail-on any    # exit 1 on any critical finding (the default)
sitedoctor <domain> --fail-on none   # always exit 0 — just report/notify, never fail the build
```

`--fail-on new` is the right choice for a site that has known,
pre-existing issues you're not fixing right now — `any` would be
permanently red and tell a pipeline nothing useful. It works by diffing
against the previous scan's critical-finding fingerprints (the same
mechanism Discord alerting uses), so it needs `data/history/` to persist
between runs — cache it in CI (see `.github/workflows/` in the
`educollege` repo for a working example).

## AI-generated fix suggestions

Set `ANTHROPIC_API_KEY` in the environment and pass `--suggest-fixes`
(CLI), or check the "AI fix suggestions" box in the web UI (the server
must have the env var set — the client can only opt in to using it, never
supply its own key). Makes one Claude API call per issue *category* that
has findings, not per individual finding, so a category with 60 broken
links still costs one call, not 60.

## Search Console traffic correlation

I don't have live API access to Search Console, so this works via CSV
import instead of a live API integration:

1. In Search Console, open Performance, and export the **Dates** tab as CSV.
2. `sitedoctor import-traffic <domain> <path-to-csv>`, or use the "Import
   Search Console data" panel in the web UI.
3. Future scans of that domain include a clicks/impressions/CTR/position
   table and sparkline alongside the health score, so a score drop and a
   traffic drop are visible side by side.

Imported data is stored in `data/traffic/` (gitignored), keyed by domain.

## Usage

### CLI

```bash
npm install
npm run dev -- example.com
```

### Web UI

```bash
npm run serve            # http://localhost:4321
npm run serve -- --port 5000
```

A single local page: type a domain, hit Scan, see a health score (0-100,
trending against past scans via a sparkline), plain-English "why this
matters" text per issue category, and the same technical findings the CLI
reports underneath — collapsed by default, expandable for detail. A
"Download report" button exports a clean standalone HTML file (open
directly, or print to PDF) for sharing without needing anyone else to run
the tool.

Each domain's scan history is kept locally in `data/history/` (gitignored)
so the score can trend over time. No external requests except the ones the
scan itself makes to the target site — no analytics, no CDN, nothing phoned
home.

### CLI flags

- `--limit <n>` — cap how many sitemap pages to check (default 40)
- `--redirect-samples <n>` — how many paths to sample for the redirect check (default 4)
- `--sitemap-attempts <n>` — how many times to re-fetch the sitemap (default 5)
- `--json` — print a JSON report instead of the terminal report
- `--out <file>` — write the JSON report to a file

Exit code is `1` if any critical finding was reported (CI-friendly), `0`
otherwise.

## Status

Personal-use CLI, v0.1. Built and dogfooded in one sitting against a real
site with real (now-fixed) bugs. Known rough edges:

- Individual page fetches (for the canonical check) aren't retried, so a
  transiently-flaky page can produce a false negative on one run — only the
  sitemap-reliability check currently retries across multiple attempts.
- No config file yet; every run is a fresh full crawl.
- No HTML report output yet, terminal + JSON only.

## Build

```bash
npm run build   # emits dist/, makes the `sitedoctor` bin runnable
```
