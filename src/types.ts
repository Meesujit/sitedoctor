export type Severity = "critical" | "warning" | "info";

export interface Finding {
  /** Which check produced this, e.g. "canonical", "structured-data". */
  check: string;
  severity: Severity;
  /** One-line human summary. */
  message: string;
  /** The page URL this finding is about, if any. */
  url?: string;
  /** Extra detail (the offending value, a list of affected URLs, etc). */
  detail?: string;
}

export interface CrawlTarget {
  /** e.g. "https://educollege.in" — no trailing slash. */
  origin: string;
  /** Page URLs discovered via sitemap/robots, absolute. */
  pages: string[];
}

export interface FetchedPage {
  url: string;
  status: number;
  /** Final URL after following redirects, if different from `url`. */
  finalUrl: string;
  redirectChain: string[];
  html: string | null;
  error?: string;
}
