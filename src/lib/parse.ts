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

export function clientIp(headers: Headers): string {
  const fwd = headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return headers.get("x-real-ip") ?? "127.0.0.1";
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
