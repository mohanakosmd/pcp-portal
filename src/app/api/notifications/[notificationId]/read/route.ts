import { NextResponse } from "next/server";

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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const status = (err as any)?.status ?? 500;
    console.error("[notifications mark-read] error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to mark notification read." },
      { status }
    );
  }
}
