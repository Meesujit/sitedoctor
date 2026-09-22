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

A single local page: type a domain, hit Scan, see the same findings the CLI
reports laid out with severity badges instead of terminal colors. No
external requests except the ones the scan itself makes to the target site —
no analytics, no CDN, nothing phoned home.

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
