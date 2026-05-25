// One-off: grant roles/run.invoker on the App Hosting Cloud Run service to the
// Firebase Hosting service agent, so the pcp-portal.web.app rewrite can invoke it.
// Uses the local `firebase login` refresh token (no gcloud needed). Safe/idempotent:
// reads the existing IAM policy, appends one member, writes it back with the etag.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Public OAuth client used by firebase-tools (embedded in its source).
const CLIENT_ID =
  "563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com";
const CLIENT_SECRET = "j9iVZfS8kkCEFUPaAeJV0sAi";

const PROJECT = "aigicare-hipaa";
const REGION = "us-central1";
const SERVICE = "pcp-portal";
const ROLE = "roles/run.invoker";
// Firebase Hosting proxies to Cloud Run anonymously, so the service must allow
// unauthenticated invocation. (The gcp-sa-firebasehosting service agent does not
// exist for this project, so a least-privilege grant isn't possible here.)
const MEMBER = "allUsers";

const candidates = [
  process.env.APPDATA &&
    path.join(process.env.APPDATA, "configstore", "firebase-tools.json"),
  path.join(os.homedir(), ".config", "configstore", "firebase-tools.json"),
].filter(Boolean);

const cfgPath = candidates.find((p) => fs.existsSync(p));
if (!cfgPath) {
  console.error("ERROR: firebase-tools configstore not found");
  process.exit(1);
}
const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
const refreshToken = cfg?.tokens?.refresh_token;
if (!refreshToken) {
  console.error("ERROR: no refresh_token in configstore");
  process.exit(1);
}

async function main() {
  const tokRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const tok = await tokRes.json();
  if (!tok.access_token) {
    console.error("ERROR: token refresh failed:", JSON.stringify(tok));
    process.exit(1);
  }
  const auth = { Authorization: `Bearer ${tok.access_token}` };
  console.log("scopes:", tok.scope || "(not returned)");
  console.log("cloud-platform scope:", String(tok.scope || "").includes("cloud-platform"));

  const base = `https://run.googleapis.com/v1/projects/${PROJECT}/locations/${REGION}/services/${SERVICE}`;

  const getRes = await fetch(`${base}:getIamPolicy`, { headers: auth });
  const policy = await getRes.json();
  if (!getRes.ok) {
    console.error("ERROR getIamPolicy:", getRes.status, JSON.stringify(policy));
    process.exit(1);
  }
  console.log("before bindings:", JSON.stringify(policy.bindings || []));

  policy.bindings = policy.bindings || [];
  let binding = policy.bindings.find((b) => b.role === ROLE);
  if (!binding) {
    binding = { role: ROLE, members: [] };
    policy.bindings.push(binding);
  }
  if (binding.members.includes(MEMBER)) {
    console.log("RESULT: already granted, nothing to do");
    return;
  }
  binding.members.push(MEMBER);

  const setRes = await fetch(`${base}:setIamPolicy`, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ policy }),
  });
  const out = await setRes.json();
  if (!setRes.ok) {
    console.error("ERROR setIamPolicy:", setRes.status, JSON.stringify(out));
    process.exit(1);
  }
  console.log("after bindings:", JSON.stringify(out.bindings || []));
  console.log("RESULT: granted run.invoker to Firebase Hosting service agent");
}

main().catch((e) => {
  console.error("UNCAUGHT:", e);
  process.exit(1);
});
