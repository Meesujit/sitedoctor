const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 10;
const USER_AGENT =
  "sitedoctor/0.1 (+https://github.com/Meesujit/sitedoctor) site-health scanner";

export interface FetchResult {
  requestedUrl: string;
  finalUrl: string;
  /** Every hop's URL, in order, including the final one. Length 1 if no redirect. */
  chain: string[];
  /** HTTP status of the final response. */
  status: number;
  /** HTTP status of each hop, aligned with `chain`. */
  chainStatuses: number[];
  body: string;
  headers: Headers;
  error?: string;
}

async function fetchWithTimeout(url: string, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    return await fetch(url, {
      ...init,
      redirect: "manual",
      signal: controller.signal,
      headers: {
        "User-Agent": USER_AGENT,
        ...init.headers,
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetches a URL, following redirects manually so callers can inspect the
 * whole chain (how many hops, whether it ever settles, where it ends up).
 * That's the whole reason this isn't just `fetch()` — several checks care
 * about the chain itself, not just where it eventually lands.
 */
export async function fetchFollowing(startUrl: string): Promise<FetchResult> {
  const chain: string[] = [];
  const chainStatuses: number[] = [];
  let current = startUrl;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let res: Response;
    try {
      res = await fetchWithTimeout(current);
    } catch (err) {
      return {
        requestedUrl: startUrl,
        finalUrl: current,
        chain: [...chain, current],
        status: 0,
        chainStatuses: [...chainStatuses, 0],
        body: "",
        headers: new Headers(),
        error: err instanceof Error ? err.message : String(err),
      };
    }

    chain.push(current);
    chainStatuses.push(res.status);

    const isRedirect = res.status >= 300 && res.status < 400;
    const location = res.headers.get("location");

    if (isRedirect && location) {
      current = new URL(location, current).toString();
      if (hop === MAX_REDIRECTS) {
        return {
          requestedUrl: startUrl,
          finalUrl: current,
          chain,
          status: res.status,
          chainStatuses,
          body: "",
          headers: res.headers,
          error: `exceeded ${MAX_REDIRECTS} redirects`,
        };
      }
      continue;
    }

    const body = await res.text().catch(() => "");
    return {
      requestedUrl: startUrl,
      finalUrl: current,
      chain,
      status: res.status,
      chainStatuses,
      body,
      headers: res.headers,
    };
  }

  // Unreachable, but keeps TypeScript happy.
  return {
    requestedUrl: startUrl,
    finalUrl: current,
    chain,
    status: 0,
    chainStatuses,
    body: "",
    headers: new Headers(),
    error: "unknown redirect loop",
  };
}

/** Fetches raw bytes (for favicon/image signature checks). */
export async function fetchBytes(url: string): Promise<{ status: number; bytes: Uint8Array | null; error?: string }> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
      signal: controller.signal,
    }).finally(() => clearTimeout(timer));
    if (!res.ok) return { status: res.status, bytes: null };
    const buf = new Uint8Array(await res.arrayBuffer());
    return { status: res.status, bytes: buf };
  } catch (err) {
    return { status: 0, bytes: null, error: err instanceof Error ? err.message : String(err) };
  }
}
