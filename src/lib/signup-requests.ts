// Pending PCP registrations awaiting admin approval (collection
// `signup_requests`). This collection is shared with the GI portal so a single
// admin portal can process both. PCP records therefore use the same canonical
// shape the GI portal writes — auto-generated doc id and the fields below —
// distinguished by `portal: "pcp"`. A pcp_users doc is only created once the
// admin portal approves the request. See migration 005-init-signup-requests.

export const SIGNUP_REQUESTS_COLLECTION = "signup_requests";

// PCP-only staging collection for in-flight create-account attempts. The OTP
// and submitted details (including the already-hashed password) live here
// (keyed by emailKey) until the email is verified; only on a correct code do we
// create the real `pcp_users` account. This keeps unverified attempts from ever
// creating a user. Documents here are short-lived and deleted on successful
// verification.
export const PCP_SIGNUP_OTP_COLLECTION = "pcp_signup_otps";

// Identifies records created by this PCP portal within the shared collection.
export const PCP_PORTAL = "pcp";

// Admin-facing review status. Lowercase to match the GI portal. Email
// verification is tracked separately via `emailVerified` so the status
// reflects the admin decision only.
export type SignupRequestStatus = "pending" | "approved" | "rejected";

// The kind of account being requested. Lets the admin queue carry more than
// just PCPs in future.
export type SignupRequestType = "pcp_user";

export type SignupRequestDoc = {
  // --- Canonical fields shared with the GI portal -----------------------
  fullName: string;
  email: string;
  phone: string;
  portal: typeof PCP_PORTAL;
  status: SignupRequestStatus;
  created_at: string;
  // --- PCP-specific OTP machinery ---------------------------------------
  // The GI portal collects no OTP; PCP verifies the email before the admin
  // approves. The admin portal ignores these extra fields for GI records.
  // No password is captured here — the admin portal provisions credentials.
  type: SignupRequestType;
  emailVerified: boolean;
  emailVerifiedAt: string | null;
  otpCode: string | null;
  otpExpiresAt: string | null;
  otpAttempts: number;
  updatedAt: string;
};

// A staged (not-yet-verified) signup attempt held in PCP_SIGNUP_OTP_COLLECTION.
// Carries just enough to verify the email and then create a pcp_users account
// once the OTP succeeds. The password is stored pre-hashed (bcrypt) — never in
// plaintext.
export type StagedSignupOtpDoc = {
  fullName: string;
  email: string;
  phone: string;
  passwordHash: string;
  otpCode: string;
  otpExpiresAt: string;
  otpAttempts: number;
  createdAt: string;
  updatedAt: string;
};
