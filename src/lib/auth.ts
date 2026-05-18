import { randomInt, createHmac, randomBytes, timingSafeEqual } from "crypto";

import { cookies } from "next/headers";

export const SESSION_COOKIE = "pcp_session";
export const LOGIN_PENDING_COOKIE = "pcp_login_pending";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;
const LOGIN_PENDING_MAX_AGE_SECONDS = 60 * 5;

export function generateOtp(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export function otpExpiresAt(): Date {
  return new Date(Date.now() + 10 * 60 * 1000);
}

function getSecret(): string {
  const secret = process.env.PCP_SESSION_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error("PCP_SESSION_SECRET must be set and at least 16 characters");
  }
  return secret;
}

function sign(payload: string): string {
  return createHmac("sha256", getSecret()).update(payload).digest("base64url");
}

export function createSessionToken(userId: string): string {
  const payload = `${userId}.${Date.now()}.${randomBytes(8).toString("hex")}`;
  return `${payload}.${sign(payload)}`;
}

export function verifySessionToken(token: string): string | null {
  const parts = token.split(".");
  if (parts.length !== 4) return null;
  const payload = parts.slice(0, 3).join(".");
  const expected = sign(payload);
  const got = parts[3];
  if (expected.length !== got.length) return null;
  const match = timingSafeEqual(Buffer.from(expected), Buffer.from(got));
  return match ? parts[0] : null;
}

export async function setSessionCookie(userId: string): Promise<void> {
  const token = createSessionToken(userId);
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
}

export async function readSessionUserId(): Promise<string | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySessionToken(token);
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

export async function setLoginPendingCookie(userId: string): Promise<void> {
  const token = createSessionToken(userId);
  const store = await cookies();
  store.set(LOGIN_PENDING_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: LOGIN_PENDING_MAX_AGE_SECONDS,
  });
}

export async function readLoginPendingUserId(): Promise<string | null> {
  const store = await cookies();
  const token = store.get(LOGIN_PENDING_COOKIE)?.value;
  if (!token) return null;
  return verifySessionToken(token);
}

export async function clearLoginPendingCookie(): Promise<void> {
  const store = await cookies();
  store.delete(LOGIN_PENDING_COOKIE);
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
