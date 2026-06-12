import { NextRequest, NextResponse } from "next/server";
import { authEmail, createSession, publicOrigin, SESSION_COOKIE } from "@/lib/auth";
import { verifyDashboardPassword } from "@/lib/password";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");

  const storedHash = process.env.DASHBOARD_PASSWORD_HASH;
  const plain = process.env.DASHBOARD_PASSWORD;

  let ok = false;

  if (storedHash) {
    ok = await verifyDashboardPassword(password, storedHash);
  } else if (plain) {
    // Legacy / dev fallback — warn so operators migrate
    if (password === plain) {
      ok = true;
      if (process.env.NODE_ENV !== "development") {
        console.warn("[auth] Using plaintext DASHBOARD_PASSWORD for login. Set DASHBOARD_PASSWORD_HASH instead (see README).");
      }
    }
  }

  if (!ok || email !== authEmail()) {
    return NextResponse.redirect(`${publicOrigin(req.headers)}/login?error=1`, 303);
  }

  const res = NextResponse.redirect(`${publicOrigin(req.headers)}/`, 303);
  res.cookies.set(SESSION_COOKIE, await createSession(email), {
    httpOnly: true,
    sameSite: "lax",
    secure: req.nextUrl.protocol === "https:",
    maxAge: 60 * 60 * 24 * 30,
    path: "/",
  });
  return res;
}
