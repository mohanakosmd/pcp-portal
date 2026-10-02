import { NextResponse } from "next/server";
import { apiErrorResponse } from "@/lib/api-error";

import { readSessionUserId } from "@/lib/auth";
import { markAllReadFor } from "@/lib/notifications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const userId = await readSessionUserId();
  if (!userId) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  try {
    const count = await markAllReadFor(userId);
    return NextResponse.json({ ok: true, markedRead: count });
  } catch (err) {
    console.error("[notifications mark-all-read] error:", err);
    return apiErrorResponse(err, "Failed to mark notifications read.");
  }
}
