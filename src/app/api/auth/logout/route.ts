import { NextResponse } from "next/server";

import { clearLoginPendingCookie, clearSessionCookie } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  await clearSessionCookie();
  await clearLoginPendingCookie();
  return NextResponse.json({ ok: true });
}
