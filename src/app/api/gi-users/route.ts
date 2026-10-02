import { NextResponse } from "next/server";
import { apiErrorResponse } from "@/lib/api-error";

import { readSessionUserId } from "@/lib/auth";
import { listGiUsers } from "@/lib/gi-users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const userId = await readSessionUserId();
  if (!userId) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  try {
    const giUsers = await listGiUsers();
    return NextResponse.json({ giUsers });
  } catch (err) {
    console.error("[gi-users GET] error:", err);
    return apiErrorResponse(err, "Failed to load GI users.");
  }
}
