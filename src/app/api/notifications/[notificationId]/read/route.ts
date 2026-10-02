import { NextResponse } from "next/server";
import { apiErrorResponse } from "@/lib/api-error";

import { readSessionUserId } from "@/lib/auth";
import { markRead } from "@/lib/notifications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(
  _request: Request,
  { params }: { params: Promise<{ notificationId: string }> }
) {
  const { notificationId } = await params;
  const userId = await readSessionUserId();
  if (!userId) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  try {
    await markRead(notificationId, userId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[notifications mark-read] error:", err);
    return apiErrorResponse(err, "Failed to mark notification read.");
  }
}
