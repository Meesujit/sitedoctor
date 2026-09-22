import * as cheerio from "cheerio";
import { fetchBytes } from "../http.js";
import type { Finding } from "../types.js";

type ImageFormat = "ico" | "png" | "jpeg" | "gif" | "svg" | "webp" | "unknown";

function sniffFormat(bytes: Uint8Array): ImageFormat {
  const hex = (n: number) => bytes[n]?.toString(16).padStart(2, "0") ?? "";
  const sig = [0, 1, 2, 3].map(hex).join("");

  if (sig === "00000100") return "ico";
  if (sig === "89504e47") return "png";
  if (sig.startsWith("ffd8ff")) return "jpeg";
  if (sig === "47494638") return "gif";
  if (sig.startsWith("52494646")) return "webp"; // RIFF....WEBP
  // SVG/XML is text, not a fixed magic number — sniff the start of the text.
  const head = new TextDecoder("utf-8", { fatal: false }).decode(bytes.slice(0, 200)).trimStart();
  if (head.startsWith("<svg") || head.startsWith("<?xml")) return "svg";
  return "unknown";
}

function extensionClaims(url: string): ImageFormat | null {
  const ext = url.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "ico":
      return "ico";
    case "png":
      return "png";
    case "jpg":
    case "jpeg":
      return "jpeg";
    case "gif":
      return "gif";
    case "svg":
      return "svg";
    case "webp":
      return "webp";
    default:
      return null;
  }
}

async function findFaviconUrls(origin: string, homepageHtml: string | null): Promise<string[]> {
  const urls = new Set<string>();
  if (homepageHtml) {
    const $ = cheerio.load(homepageHtml);
    $('link[rel~="icon"]').each((_, el) => {
      const href = $(el).attr("href");
      if (href) urls.add(new URL(href, origin).toString());
    });
  }
  if (urls.size === 0) urls.add(`${origin}/favicon.ico`);
  return Array.from(urls);
}

/**
 * Checks that whatever's declared as the site's icon is actually a valid
 * image of the type its own extension/rel claims — by reading its real
 * bytes, not by trusting the filename. That's the whole bug class this
 * catches: a file that looks fine by name but isn't what it claims to be.
 */
export async function checkFavicon(origin: string, homepageHtml: string | null): Promise<Finding[]> {
  const findings: Finding[] = [];
  const candidates = await findFaviconUrls(origin, homepageHtml);

  for (const url of candidates) {
    const { status, bytes, error } = await fetchBytes(url);

    if (error || !bytes) {
      findings.push({
        check: "favicon",
        severity: "warning",
        message: `Favicon not reachable${status ? ` (HTTP ${status})` : ""}${error ? `: ${error}` : ""}`,
        url,
      });
      continue;
    }

    if (bytes.length < 16) {
      findings.push({
        check: "favicon",
        severity: "critical",
        message: `Favicon file is suspiciously small (${bytes.length} bytes) to be a real icon`,
        url,
      });
      continue;
    }

    const actual = sniffFormat(bytes);
    const claimed = extensionClaims(url);

    if (actual === "unknown") {
      findings.push({
        check: "favicon",
        severity: "warning",
        message: "Favicon bytes don't match any recognized image format",
        url,
      });
    } else if (claimed && actual !== claimed && !(claimed === "ico" && actual === "png")) {
      // .ico containing a PNG-encoded frame is normal (that's how modern
      // ICO files often store their image data) — anything else claiming
      // to be one format while actually being another is the real bug.
      findings.push({
        check: "favicon",
        severity: "critical",
        message: `File is served as .${claimed} but its actual content is ${actual}${
          actual === "svg" ? " (likely a wrong file copied into place)" : ""
        }`,
        url,
      });
    }
  }

  return findings;
}
