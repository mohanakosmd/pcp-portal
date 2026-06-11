import { randomInt, createHmac, randomBytes, timingSafeEqual } from "crypto";

import { cookies } from "next/headers";

// IMPORTANT: must be "__session". When the app is served through Firebase
// Hosting (pcp-portal.web.app rewrites to the App Hosting/Cloud Run backend),
// Hosting strips every cookie EXCEPT one named "__session" from cacheable (GET)
// requests so it can CDN-cache them. The session is read during GET page renders
// (dashboard layout/pages) and GET API routes, so any other name is dropped on
// pcp-portal.web.app and every protected page bounces to /login. Do not rename.
// (LOGIN_PENDING is only read in POST handlers, which are not cacheable and keep
// their cookies, so it doesn't need the __session name.)
export const SESSION_COOKIE = "__session";
export const LOGIN_PENDING_COOKIE = "pcp_login_pending";
// Password-reset machinery. Both are read only in non-cacheable POST handlers,
// so they don't need the "__session" name (see SESSION_COOKIE note above).
//   pcp_reset_pending    — set after a reset OTP is sent; gates the verify step.
//   pcp_reset_authorized — set after the OTP is verified; gates setting the new
//                          password. Kept separate so a verified user can't be
//                          confused with a logged-in (__session) user.
export const RESET_PENDING_COOKIE = "pcp_reset_pending";
export const RESET_AUTHORIZED_COOKIE = "pcp_reset_authorized";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;
const LOGIN_PENDING_MAX_AGE_SECONDS = 60 * 5;
const RESET_PENDING_MAX_AGE_SECONDS = 60 * 10;
const RESET_AUTHORIZED_MAX_AGE_SECONDS = 60 * 10;

export function generateOtp(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

// OTP validity window (5 minutes). Must match the visible countdown in the OTP
// forms (OtpForm, ForgotPasswordOtpForm, CreateAccountPrompt — INITIAL_SECONDS)
// so a code that shows as expired on screen is also rejected by the verify
// routes. The "Resend" link appears earlier (after RESEND_AFTER_SECONDS), but
// that's independent of expiry.
export const OTP_TTL_SECONDS = 300;

export function otpExpiresAt(): Date {
  return new Date(Date.now() + OTP_TTL_SECONDS * 1000);
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

export async function setResetPendingCookie(userId: string): Promise<void> {
  const token = createSessionToken(userId);
  const store = await cookies();
  store.set(RESET_PENDING_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: RESET_PENDING_MAX_AGE_SECONDS,
  });
}

export async function readResetPendingUserId(): Promise<string | null> {
  const store = await cookies();
  const token = store.get(RESET_PENDING_COOKIE)?.value;
  if (!token) return null;
  return verifySessionToken(token);
}

export async function clearResetPendingCookie(): Promise<void> {
  const store = await cookies();
  store.delete(RESET_PENDING_COOKIE);
}

export async function setResetAuthorizedCookie(userId: string): Promise<void> {
  const token = createSessionToken(userId);
  const store = await cookies();
  store.set(RESET_AUTHORIZED_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: RESET_AUTHORIZED_MAX_AGE_SECONDS,
  });
}

export async function readResetAuthorizedUserId(): Promise<string | null> {
  const store = await cookies();
  const token = store.get(RESET_AUTHORIZED_COOKIE)?.value;
  if (!token) return null;
  return verifySessionToken(token);
}

export async function clearResetAuthorizedCookie(): Promise<void> {
  const store = await cookies();
  store.delete(RESET_AUTHORIZED_COOKIE);
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * Enforces the password policy shown on the reset-password screen:
 * at least 8 characters with uppercase, lowercase, number, and special char.
 */
export function isStrongPassword(password: string): boolean {
  return (
    password.length >= 8 &&
    /[a-z]/.test(password) &&
    /[A-Z]/.test(password) &&
    /[0-9]/.test(password) &&
    /[^A-Za-z0-9]/.test(password)
  );
}
