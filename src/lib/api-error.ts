// Client-safe API errors. Throw `ApiError` for failures whose message is meant
// for the user (not found, no access, bad input). Anything else — Firestore,
// network, SendGrid, Gemini, bugs — is internal: routes log it server-side and
// `apiErrorResponse` replaces it with a generic message and a 500, so paths,
// collection names and upstream errors never reach the client.

import { NextResponse } from "next/server";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** JSON error response: the ApiError's own message/status, else `fallback` with 500. */
export function apiErrorResponse(err: unknown, fallback: string): NextResponse {
  if (err instanceof ApiError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  return NextResponse.json({ error: fallback }, { status: 500 });
}
