import { describe, it, expect } from "vitest";
import { isBot, parseUA, referrerSource, clientIp, geoLookup, geoResolve, countryLabel } from "@/lib/parse";

describe("parse", () => {
  describe("isBot", () => {
    it("detects obvious bots", () => {
      expect(isBot("Googlebot/2.1")).toBe(true);
      expect(isBot("Mozilla/5.0 (compatible; bingbot/2.0)")).toBe(true);
      expect(isBot("curl/7.64.1")).toBe(true);
      expect(isBot("python-requests/2.28")).toBe(true);
      expect(isBot("HeadlessChrome")).toBe(true);
    });

    it("allows real browsers", () => {
      expect(isBot("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")).toBe(false);
      expect(isBot("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1")).toBe(false);
    });

    it("treats null/undefined as bot (safe default)", () => {
      expect(isBot(null)).toBe(true);
      expect(isBot(undefined as any)).toBe(true);
      expect(isBot("")).toBe(true);
    });
  });

  describe("parseUA", () => {
    it("parses common desktop", () => {
      const r = parseUA("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");
      expect(r.browser).toMatch(/Chrome/i);
      expect(r.os).toMatch(/macOS|Mac OS/i);
      expect(r.device).toBe("Desktop");
    });

    it("parses mobile", () => {
      const r = parseUA("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1");
      expect(r.device).toBe("Mobile");
    });

    it("falls back gracefully", () => {
      const r = parseUA("weird/1.0");
      expect(r.browser).toBe("Unknown");
      expect(r.os).toBe("Unknown");
      expect(r.device).toBe("Desktop");
    });
  });

  describe("referrerSource", () => {
    const site = "example.com";

    it("prefers explicit utm_source", () => {
      expect(referrerSource("https://google.com", "newsletter", site)).toBe("newsletter");
    });

    it("returns Direct for no referrer", () => {
      expect(referrerSource(null, null, site)).toBe("Direct");
      expect(referrerSource("", null, site)).toBe("Direct");
    });

    it("returns Direct for self referrer", () => {
      expect(referrerSource("https://example.com/blog", null, site)).toBe("Direct");
      expect(referrerSource("https://www.example.com/", null, site)).toBe("Direct");
    });

    it("treats cross-subdomain traffic as internal (Direct)", () => {
      // Recommended setup: register the ROOT domain as the site, then every
      // subdomain's traffic is internal (one unified property).
      expect(referrerSource("https://app.example.com/", null, "example.com")).toBe("Direct");
      expect(referrerSource("https://funds.bulltiq.com/", null, "bulltiq.com")).toBe("Direct");
      expect(referrerSource("https://dr.bulltiq.com/", null, "bulltiq.com")).toBe("Direct");
      // subdomain site, root referrer is still internal
      expect(referrerSource("https://example.com/", null, "app.example.com")).toBe("Direct");
      // a genuinely different domain that merely ends similarly is NOT internal
      expect(referrerSource("https://notexample.com/", null, "example.com")).toBe("notexample.com");
    });

    it("normalizes known sources including modern AI", () => {
      expect(referrerSource("https://www.google.com/search", null, site)).toBe("Google");
      expect(referrerSource("https://x.com/foo", null, site)).toBe("X (Twitter)");
      expect(referrerSource("https://t.co/bar", null, site)).toBe("X (Twitter)");
      expect(referrerSource("https://chatgpt.com/share/xxx", null, site)).toBe("ChatGPT");
      expect(referrerSource("https://claude.ai/chat/yyy", null, site)).toBe("Claude");
      expect(referrerSource("https://news.ycombinator.com/item?id=1", null, site)).toBe("Hacker News");
      expect(referrerSource("https://producthunt.com/posts/1", null, site)).toBe("Product Hunt");
    });

    it("falls back to hostname for unknown", () => {
      expect(referrerSource("https://weirdblog.dev/post", null, site)).toBe("weirdblog.dev");
    });

    it("handles malformed referrer", () => {
      expect(referrerSource("not-a-url", null, site)).toBe("Direct");
    });
  });

  describe("clientIp", () => {
    it("prefers x-forwarded-for (first entry)", () => {
      const h = new Headers({ "x-forwarded-for": "203.0.113.45, 70.41.3.18, 150.172.238.178" });
      expect(clientIp(h)).toBe("203.0.113.45");
    });

    it("falls back to x-real-ip", () => {
      const h = new Headers({ "x-real-ip": "198.51.100.23" });
      expect(clientIp(h)).toBe("198.51.100.23");
    });

    it("defaults to localhost", () => {
      expect(clientIp(new Headers())).toBe("127.0.0.1");
    });
  });

  describe("geoLookup", () => {
    it("returns empty for private/local IPs", () => {
      expect(geoLookup("127.0.0.1")).toEqual({ country: null, region: null, city: null });
      expect(geoLookup("::1")).toEqual({ country: null, region: null, city: null });
      expect(geoLookup("10.0.0.5")).toEqual({ country: null, region: null, city: null });
      expect(geoLookup("192.168.1.10")).toEqual({ country: null, region: null, city: null });
    });

    // Note: real geoip-lite data may or may not resolve in the test env.
    // We only assert it doesn't throw and returns the expected shape.
    it("does not throw on public IP and returns expected shape", () => {
      const res = geoLookup("8.8.8.8");
      expect(res).toHaveProperty("country");
      expect(res).toHaveProperty("region");
      expect(res).toHaveProperty("city");
    });
  });

  describe("geoResolve", () => {
    it("prefers edge geo headers when present", () => {
      const h = new Headers({
        "x-vercel-ip-country": "DE",
        "x-vercel-ip-country-region": "BE",
        "x-vercel-ip-city": "Berlin",
      });
      expect(geoResolve(h, "8.8.8.8")).toEqual({ country: "DE", region: "BE", city: "Berlin" });
    });

    it("reads Cloudflare country header", () => {
      const h = new Headers({ "cf-ipcountry": "gb" });
      expect(geoResolve(h, "8.8.8.8").country).toBe("GB");
    });

    it("ignores placeholder country codes and falls back to IP lookup", () => {
      const h = new Headers({ "cf-ipcountry": "XX" });
      const res = geoResolve(h, "127.0.0.1");
      expect(res).toEqual({ country: null, region: null, city: null });
    });
  });

  describe("countryLabel", () => {
    it("turns an ISO code into flag + name", () => {
      expect(countryLabel("US")).toBe("🇺🇸 United States");
      expect(countryLabel("de")).toContain("Germany");
    });
    it("handles unknown/empty gracefully", () => {
      expect(countryLabel(null)).toBe("Unknown");
      expect(countryLabel("Direct")).toBe("Direct");
    });
  });
});