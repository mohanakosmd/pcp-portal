# PCP Portal

Next.js (App Router, TypeScript) application for the Primary Care Physician portal.

## Layouts

- `src/app/(auth)/layout.tsx` — split-screen auth shell (login, OTP, forgot/reset password, success).
- `src/app/(dashboard)/layout.tsx` — sidebar + topbar + footer shell for authenticated pages (dashboard, cases, reports, communication, create-case).

The two layouts use the original template CSS in `src/styles/`:
- `auth.css` — auth shell + modal styles (from template `styles.css`)
- `dashboard.css` — dashboard shell + nav styles (from template `dashboard.css`)

## Getting started

```bash
npm install
npm run dev
```

Open http://localhost:3000.
