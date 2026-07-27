import { NextResponse } from "next/server";

import { readSessionUserId } from "@/lib/auth";
import { PCP_USERS_COLLECTION } from "@/lib/firebase";
import { getDocument, nowIso, upsertDocument } from "@/lib/firestore-rest";
import { GENDER_VALUES, type GenderEnum } from "@/lib/cases";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ProfileBody = Partial<{
  name: unknown;
  mobile: unknown;
  phoneDial: unknown;
  fax: unknown;
  gender: unknown;
  npiCredential: unknown;
  specialty: unknown;
}>;

// Optional editable field: present-as-string wins (empty string clears the
// value); absent leaves the stored value untouched. Returns undefined when the
// field wasn't sent at all.
function asEditable(v: unknown, max: number): string | undefined {
  return typeof v === "string" ? v.trim().slice(0, max) : undefined;
}

export async function PATCH(request: Request) {
  const userId = await readSessionUserId();
  if (!userId) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  let body: ProfileBody;
  try {
    body = (await request.json()) as ProfileBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  // Full name is the one required field.
  if (typeof body.name === "string" && !body.name.trim()) {
    return NextResponse.json({ error: "Enter your full name." }, { status: 400 });
  }

  const name = asEditable(body.name, 120);
  const mobile = asEditable(body.mobile, 40);
  const phoneDial = asEditable(body.phoneDial, 8);
  const fax = asEditable(body.fax, 40);
  const npiCredential = asEditable(body.npiCredential, 40);
  const specialty = asEditable(body.specialty, 120);

  // Gender must be one of the known enum values (or blank to clear it).
  let gender: string | undefined;
  if (typeof body.gender === "string") {
    const g = body.gender.trim();
    if (g && !(GENDER_VALUES as string[]).includes(g)) {
      return NextResponse.json({ error: "Select a valid gender." }, { status: 400 });
    }
    gender = g as GenderEnum | "";
  }

  try {
    const user = await getDocument(PCP_USERS_COLLECTION, userId);
    if (!user || user.data.verified !== true) {
      return NextResponse.json({ error: "Account not found." }, { status: 404 });
    }

    const now = nowIso();
    const next: Record<string, unknown> = { updatedAt: now };
    if (name !== undefined) next.name = name;
    if (mobile !== undefined) next.mobile = mobile;
    if (phoneDial !== undefined) next.phoneDial = phoneDial;
    if (fax !== undefined) next.fax = fax;
    if (gender !== undefined) next.gender = gender;
    if (npiCredential !== undefined) next.npiCredential = npiCredential;
    if (specialty !== undefined) next.specialty = specialty;

    await upsertDocument(PCP_USERS_COLLECTION, userId, next);

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[profile PATCH] error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to save profile." },
      { status: 500 }
    );
  }
}
