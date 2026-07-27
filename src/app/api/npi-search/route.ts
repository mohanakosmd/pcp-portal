import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Proxies the public NPI-registry search Cloud Function so the browser doesn't
// have to deal with cross-origin requests. Returns the upstream JSON as-is.
const NPI_SEARCH_URL =
  "https://us-central1-aigicare-hipaa.cloudfunctions.net/npiSearch";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const firstName = (searchParams.get("first_name") ?? "").trim();
  const lastName = (searchParams.get("last_name") ?? "").trim();
  const state = (searchParams.get("state") ?? "").trim();
  const number = (searchParams.get("number") ?? "").replace(/\D/g, "");
  const limit = (searchParams.get("limit") ?? "").trim() || "10";

  if (number) {
    if (number.length !== 10) {
      return NextResponse.json(
        { error: "Enter a valid 10-digit NPI number." },
        { status: 400 }
      );
    }
  } else if (!firstName && !lastName) {
    return NextResponse.json(
      { error: "Enter a first or last name to search." },
      { status: 400 }
    );
  }

  const params = new URLSearchParams({ limit });
  if (number) {
    params.set("npi_number", number);
  } else {
    if (firstName) params.set("first_name", firstName);
    if (lastName) params.set("last_name", lastName);
    if (state) params.set("state", state);
  }

  try {
    const res = await fetch(`${NPI_SEARCH_URL}?${params.toString()}`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    const text = await res.text();
    let data: unknown = null;
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
    if (!res.ok || !data) {
      return NextResponse.json(
        { error: "NPI registry search failed. Please try again." },
        { status: 502 }
      );
    }
    return NextResponse.json(data);
  } catch (err) {
    console.error("[npi-search] error:", err);
    return NextResponse.json(
      { error: "Could not reach the NPI registry. Please try again." },
      { status: 502 }
    );
  }
}
