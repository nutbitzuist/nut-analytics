/**
 * Single-user session auth (Edge-safe).
 * Password hashing lives in ./password (Node-only, imported only by the login route).
 *
 * Env:
 *   AUTH_EMAIL, DASHBOARD_PASSWORD (legacy), DASHBOARD_PASSWORD_HASH (recommended), SESSION_SECRET
 */

export const SESSION_COOKIE = "nut_session";
const SESSION_DAYS = 30;

function secret(): string {
  return process.env.SESSION_SECRET || process.env.DASHBOARD_PASSWORD || "";
}

export function authEmail(): string {
  return (process.env.AUTH_EMAIL || "email.nutty@gmail.com").toLowerCase();
}

// Behind Railway's proxy, req.url carries the internal host (localhost:8080),
// so redirect URLs must be built from the forwarded headers.
export function publicOrigin(headers: Headers): string {
  const host = headers.get("x-forwarded-host") ?? headers.get("host") ?? "localhost:3000";
  const proto = headers.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (const b of arr) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sign(payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return b64url(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload)));
}

export async function createSession(email: string): Promise<string> {
  const payload = b64url(
    new TextEncoder().encode(JSON.stringify({ email, exp: Date.now() + SESSION_DAYS * 86_400_000 }))
  );
  return `${payload}.${await sign(payload)}`;
}

export async function verifySession(token: string | undefined): Promise<string | null> {
  if (!token || !secret()) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  if ((await sign(payload)) !== sig) return null;
  try {
    const json = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
    if (typeof json.email !== "string" || typeof json.exp !== "number" || json.exp < Date.now()) return null;
    return json.email;
  } catch {
    return null;
  }
}

// Password hashing moved to ./password.ts (Node-only module).
// It is intentionally not re-exported here so that middleware (Edge) stays clean.
