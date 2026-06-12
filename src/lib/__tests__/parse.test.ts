import { describe, it, expect } from "vitest";
import { isBot, parseUA, referrerSource, clientIp, geoLookup } from "@/lib/parse";

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
});