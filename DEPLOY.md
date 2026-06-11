# Deploying PCP Portal to Firebase App Hosting

This is a Next.js 15 app with server-rendered pages and API routes, so it runs on
**Firebase App Hosting** (Cloud Run under the hood) — not plain static Firebase
Hosting. Firestore is the database; App Hosting is the compute.

Repo config already in place:
- `apphosting.yaml` — runtime config + env vars + secret references
- `.firebaserc` — pins the default project to `aigicare-hipaa`
- `.env.example` — documents required env vars (no secrets)

## Prerequisites

- The `aigicare-hipaa` project is on the **Blaze** plan. ✅ (required by App Hosting)
- Node 20+ and npm.
- You can authenticate to Firebase as a project Owner/Editor.

## 1. Install the Firebase CLI (one-time)

```bash
npm install -g firebase-tools
firebase --version   # confirm it installed
```

## 2. Log in (one-time, interactive — opens a browser)

```bash
firebase login
firebase use aigicare-hipaa   # already the default via .firebaserc
```

## 3. Create the App Hosting backend (one-time)

This connects the GitHub repo so every push to `main` builds and deploys.

```bash
firebase apphosting:backends:create --project aigicare-hipaa
```

You'll be prompted for:
- **Region** — e.g. `us-central1`.
- **GitHub connection** — authorize the Firebase GitHub app and pick the repo
  `mohanakosmd/pcp-portal`.
- **Live branch** — `main`.
- **Root directory** — `/` (repo root).
- **Backend ID** — e.g. `pcp-portal`.

After creation, note the live URL it prints, e.g.
`https://pcp-portal--aigicare-hipaa.us-central1.hosted.app`.

## 4. Set the three secrets in Cloud Secret Manager

`apphosting.yaml` references these by name. Create each one and grant the backend
access when prompted:

```bash
firebase apphosting:secrets:set PCP_SESSION_SECRET
firebase apphosting:secrets:set SENDGRID_API_KEY
firebase apphosting:secrets:set GEMINI_API_KEY
```

- **PCP_SESSION_SECRET** — paste a strong random string (>= 16 chars). Do NOT reuse
  the dev value `dev-only-change-me-...`. Generate one with:
  `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`
- **SENDGRID_API_KEY** — your SendGrid API key (`SG.…`).
- **GEMINI_API_KEY** — your Google Gemini API key (`AIza…`).

If the CLI offers to add these to `apphosting.yaml`, you can skip it — they're
already declared there.

> The non-secret values (public `NEXT_PUBLIC_FIREBASE_*`, `SENDGRID_SENDER_EMAIL`)
> are already in `apphosting.yaml` in plaintext, which is fine
> — the Firebase web config is public by design.

## 5. Deploy

App Hosting builds from the committed GitHub state, so commit and push the config
(and any pending changes) to `main`:

```bash
git add apphosting.yaml .firebaserc .env.example .eslintrc.json DEPLOY.md
git commit -m "Add Firebase App Hosting config"
git push origin main
```

The push triggers a rollout automatically. Watch it in the Firebase console
(App Hosting → your backend) or with:

```bash
firebase apphosting:rollouts:list pcp-portal
```

To trigger a build manually without a code change:

```bash
firebase deploy --only apphosting
```

## 6. Set the public app URL, then redeploy

`NEXT_PUBLIC_APP_URL` in `apphosting.yaml` is a placeholder (`https://CHANGE-ME.hosted.app`).
It's used to build absolute links in notification emails and is baked in at build
time, so:

1. After the first deploy, copy the real backend URL (or your custom domain).
2. Replace `https://CHANGE-ME.hosted.app` in `apphosting.yaml` with it.
3. Commit + push again to rebuild.

## Notes / gotchas

- **Build runs lint.** `next build` lints during the build. The repo's ESLint config
  was fixed (`.eslintrc.json` now registers the `@typescript-eslint` plugin) so the
  build passes; don't revert that or the cloud build will fail.
- **Firestore access.** API routes talk to Firestore over REST using the public web
  API key, gated entirely by **Firestore security rules**. Make sure your rules in the
  `aigicare-hipaa` project allow the access the app needs — App Hosting changes the
  compute, not the rules. (For a HIPAA workload, review these rules carefully; relying
  on a public API key + permissive rules is a real exposure.)
- **Custom domain.** Add one under App Hosting → your backend → Domains; then update
  `NEXT_PUBLIC_APP_URL` to match and redeploy.
- **Scaling/cost.** `runConfig` in `apphosting.yaml` scales to zero when idle. Raise
  `minInstances` if cold-start latency is a problem (costs more).
