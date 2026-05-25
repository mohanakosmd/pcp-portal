import { NextResponse } from "next/server";

import { readSessionUserId } from "@/lib/auth";
import { countUnreadFor, listNotificationsFor } from "@/lib/notifications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const userId = await readSessionUserId();
  if (!userId) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  const url = new URL(request.url);
  const unreadOnly = url.searchParams.get("unreadOnly") === "true";
  const limit = Math.min(Number(url.searchParams.get("limit")) || 20, 100);

  try {
    const [notifications, unreadCount] = await Promise.all([
      listNotificationsFor(userId, { limit, unreadOnly }),
      countUnreadFor(userId),
    ]);
    return NextResponse.json({ notifications, unreadCount });
  } catch (err) {
    console.error("[notifications GET] error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load notifications." },
      { status: 500 }
    );
  }
}
