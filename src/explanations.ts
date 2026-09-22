/**
 * Plain-English framing per check, for anyone reading a report who doesn't
 * know what a canonical tag or JSON-LD @id is. Technical findings still
 * carry their exact message/url/detail — this is the "why should I care"
 * layer on top, not a replacement for it.
 */
export interface CheckExplanation {
  title: string;
  whyItMatters: string;
}

export const CHECK_EXPLANATIONS: Record<string, CheckExplanation> = {
  fetch: {
    title: "Broken pages",
    whyItMatters:
      "These pages return an error instead of loading. They're invisible to search engines re-checking them and to anyone who lands on one — from a search result, a shared link, or an old bookmark.",
  },
  canonical: {
    title: "Duplicate-content signals",
    whyItMatters:
      "Search engines use a page's \"canonical\" tag to decide which version of it is the real one to rank. When it's missing, wrong, or copy-pasted across many pages, search engines can pick the wrong page as authoritative — or drop the real ones out of search results entirely. This is the exact bug class that caused this site's pages to disappear from Google.",
  },
  redirects: {
    title: "Redirect health (www / https)",
    whyItMatters:
      "Visitors and search engines reach a site through slightly different URLs — with or without \"www\", http or https. Each should land on the correct page in one hop. Extra hops slow the page down and occasionally break outright, and can dilute the ranking value a link is passing along.",
  },
  "structured-data": {
    title: "Structured data (rich results) accuracy",
    whyItMatters:
      "This is the machine-readable summary search engines use for rich results — FAQ dropdowns, star ratings, business info in search listings. When the same block is copy-pasted across unrelated pages, search engines lose confidence in what's real, which can suppress rich results.",
  },
  "sitemap-reliability": {
    title: "Sitemap reliability",
    whyItMatters:
      "The sitemap is the map handed to search engines listing every page that exists. If it's flaky — sometimes complete, sometimes missing entries — new content gets discovered slower and existing pages can fall out of the regular crawl rotation.",
  },
  favicon: {
    title: "Brand presentation",
    whyItMatters:
      "The small icon shown in browser tabs, bookmarks, and some search results. A broken one looks unprofessional, and its breakage often points at a deploy step that's quietly failing.",
  },
};

export function explainCheck(check: string): CheckExplanation {
  return (
    CHECK_EXPLANATIONS[check] ?? {
      title: check,
      whyItMatters: "",
    }
  );
}
