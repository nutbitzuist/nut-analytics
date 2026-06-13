import { UAParser } from "ua-parser-js";

const BOT_PATTERN =
  /bot|crawl|spider|slurp|bingpreview|pingdom|lighthouse|headless|phantomjs|scrapy|httpclient|python-requests|curl|wget|facebookexternalhit|monitoring|uptime/i;

export function isBot(ua: string | null): boolean {
  if (!ua) return true;
  return BOT_PATTERN.test(ua);
}

export function parseUA(ua: string) {
  const r = new UAParser(ua).getResult();
  const deviceType = r.device.type; // mobile | tablet | undefined
  return {
    browser: r.browser.name ?? "Unknown",
    os: r.os.name ?? "Unknown",
    device: deviceType === "mobile" ? "Mobile" : deviceType === "tablet" ? "Tablet" : "Desktop",
  };
}

// Normalize a raw referrer URL into a channel name, the way Plausible/DataFast do.
const SOURCES: [RegExp, string][] = [
  [/google\./i, "Google"],
  [/bing\./i, "Bing"],
  [/duckduckgo\./i, "DuckDuckGo"],
  [/search\.brave\./i, "Brave Search"],
  [/yandex\./i, "Yandex"],
  [/baidu\./i, "Baidu"],
  [/ecosia\./i, "Ecosia"],
  [/(twitter\.com|^t\.co$|\bx\.com)/i, "X (Twitter)"],
  [/facebook\.|fb\.com|l\.facebook/i, "Facebook"],
  [/instagram\./i, "Instagram"],
  [/linkedin\.|lnkd\.in/i, "LinkedIn"],
  [/reddit\.|redd\.it/i, "Reddit"],
  [/news\.ycombinator|hckrnews/i, "Hacker News"],
  [/producthunt\./i, "Product Hunt"],
  [/youtube\.|youtu\.be/i, "YouTube"],
  [/tiktok\./i, "TikTok"],
  [/pinterest\./i, "Pinterest"],
  [/github\./i, "GitHub"],
  [/substack\./i, "Substack"],
  [/medium\./i, "Medium"],
  [/(^|\.)t\.me$|telegram\./i, "Telegram"],
  [/whatsapp\./i, "WhatsApp"],
  [/chatgpt\.com|chat\.openai/i, "ChatGPT"],
  [/perplexity\./i, "Perplexity"],
  [/claude\.ai/i, "Claude"],
  [/gemini\.google/i, "Gemini"],
];

export function referrerSource(
  referrer: string | null | undefined,
  utmSource: string | null | undefined,
  siteDomain: string
): string {
  if (utmSource) return utmSource;
  if (!referrer) return "Direct";
  let host: string;
  try {
    host = new URL(referrer).hostname.replace(/^www\./, "");
  } catch {
    return "Direct";
  }
  const self = siteDomain.replace(/^www\./, "");
  // Internal traffic — same host, or a subdomain on either side (dr.bulltiq.com
  // ↔ bulltiq.com ↔ funds.bulltiq.com). Treated as Direct so cross-subdomain
  // navigation isn't logged as a referral from your own property.
  if (!host || host === self || host.endsWith("." + self) || self.endsWith("." + host)) return "Direct";
  for (const [re, name] of SOURCES) if (re.test(host)) return name;
  return host;
}

/** "US" -> "🇺🇸 United States". Falls back to the raw value for non-ISO inputs. */
export function countryLabel(code: string | null | undefined): string {
  if (!code) return "Unknown";
  const c = code.toUpperCase();
  if (!/^[A-Z]{2}$/.test(c)) return code;
  let flag = "";
  try {
    flag = String.fromCodePoint(...[...c].map((ch) => 0x1f1e6 + (ch.charCodeAt(0) - 65)));
  } catch {
    flag = "";
  }
  let name = c;
  try {
    name = new Intl.DisplayNames(["en"], { type: "region" }).of(c) || c;
  } catch {
    /* keep code */
  }
  return flag ? `${flag} ${name}` : name;
}

export function clientIp(headers: Headers): string {
  const fwd = headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return headers.get("x-real-ip") ?? "127.0.0.1";
}

export type Geo = { country: string | null; region: string | null; city: string | null };

/**
 * Resolve geo, preferring accurate edge/CDN headers (Cloudflare, Vercel, generic)
 * when the app is fronted by a geo-aware proxy, and falling back to the bundled
 * geoip-lite database by IP. Always returns 2-letter country codes when possible.
 */
export function geoResolve(headers: Headers, ip: string): Geo {
  const h = (k: string) => {
    const v = headers.get(k);
    return v && v.trim() ? v.trim() : null;
  };
  const country =
    h("cf-ipcountry") || h("x-vercel-ip-country") || h("x-geo-country") || h("x-country-code");
  if (country && country !== "XX" && country !== "T1") {
    const region = h("x-vercel-ip-country-region") || h("cf-region-code") || h("x-geo-region");
    let city = h("x-vercel-ip-city") || h("cf-ipcity") || h("x-geo-city");
    try {
      if (city) city = decodeURIComponent(city);
    } catch {
      /* keep raw */
    }
    return { country: country.toUpperCase(), region, city };
  }
  return geoLookup(ip);
}

export function geoLookup(ip: string): { country: string | null; region: string | null; city: string | null } {
  const empty = { country: null, region: null, city: null };
  if (!ip || ip === "127.0.0.1" || ip === "::1" || ip.startsWith("192.168.") || ip.startsWith("10.")) return empty;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const geoip = require("geoip-lite");
    const g = geoip.lookup(ip);
    if (!g) return empty;
    return { country: g.country ?? null, region: g.region ?? null, city: g.city ?? null };
  } catch {
    return empty;
  }
}
