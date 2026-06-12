import { NextRequest, NextResponse } from "next/server";
import { publicOrigin, SESSION_COOKIE } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const res = NextResponse.redirect(`${publicOrigin(req.headers)}/login`, 303);
  res.cookies.delete(SESSION_COOKIE);
  return res;
}
