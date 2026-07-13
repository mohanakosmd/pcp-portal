# Create-Case data schema

This document specifies how data captured by the "Create New Case" wizard is
persisted in Firestore + Firebase Storage. It is the source of truth for the
upcoming `002-init-pcp-cases` migration and the `POST/PATCH /api/cases/*`
routes that will implement it.

## Top-level data model

```
pcp_users/{userId}
   └─ ownerUserId ─────────┐
                           │
pcp_cases/{caseId}  ◄──────┘
   ├─ <root fields>        (case index card; small, queried in lists)
   ├─ about/
   │     └─ data           (10 fields — full Step 1 payload)
   ├─ health/
   │     └─ data           (8 fields — full Step 2 payload)
   └─ documents/
         ├─ {fileId}       (one doc per uploaded file)
         └─ ...

Firebase Storage bucket: aigicare-hipaa.firebasestorage.app
   pcp_cases/{caseId}/documents/{fileId}/{original-filename}
```

`caseId` is an auto-generated Firestore push ID (20-char). Subcollection group
docs (`about/data`, `health/data`) use a **fixed document ID** `"data"` — one
doc per group per case.

## `pcp_cases/{caseId}` — root case doc

Small, fast to read for list views. Mirrors completion flags so we don't need
to fetch subcollections to render a case row.

| Field | Type | Required | Enum / constraint | Notes |
|---|---|---|---|---|
| `ownerUserId` | string | yes | matches an id in `pcp_users` | FK; never null on a real case |
| `status` | string | yes | `draft` \| `submitted` \| `under_review` \| `completed` \| `closed` | Server-controlled; initial value `draft` |
| `currentStep` | int | yes | 1 \| 2 \| 3 | Last step the user reached; used to resume the wizard |
| `title` | string | yes | ≤120 chars | Denormalized: `"${about.fullLegalName} · ${health.inboxMessage[:40]}"` (computed on save); used by the dashboard "Recent requests" table |
| `shortCode` | string | yes | `REQ-` + 5 random digits, unique per user | Stable display ID shown to the user (e.g. `REQ-99321`) |
| `aboutComplete` | bool | yes | — | True when `about/data` has all 10 fields populated; computed on every About write |
| `healthComplete` | bool | yes | — | True when `health/data` has all 8 fields populated |
| `documentsCount` | int | yes | ≥ 0 | Mirror of subcollection size; incremented/decremented on upload/delete |
| `submittedAt` | ISO timestamp \| null | no | — | Filled when status transitions to `submitted` |
| `statusUpdatedAt` | ISO timestamp | yes | — | Bumped on every `status` change |
| `createdAt` | ISO timestamp | yes | — | Immutable after create |
| `updatedAt` | ISO timestamp | yes | — | Bumped on any write to root or to any subcollection |
| `aiSummary` | string \| null | no | ≤ 4000 chars | Future use: post-submit AI summary text |
| `aiSummaryGeneratedAt` | ISO timestamp \| null | no | — | When the summary was generated |
| `aiSuggestions` | map \| null | no | — | Structured, AI-generated GI decision support produced at submit (see below). Null until generated |
| `aiSuggestionsGeneratedAt` | ISO timestamp \| null | no | — | When the suggestion set was generated |

#### `aiSuggestions` map

Generated alongside `aiSummary` by `POST /api/cases/{caseId}/ai-summary`, mapping 1:1 to the controls of the GI "Clinical Diagnosis & Plan" workspace so it can pre-populate that form. Every value is a suggestion for a clinician to confirm — never a prescription. All catalogs live in `src/lib/assessment-plan-catalog.ts`.

| Field | GI control | Type | Notes |
| --- | --- | --- | --- |
| `diagnosis` | Edit Diagnosis textarea | string | Provisional working impression, ≤ 1200 chars |
| `files` | Assessment & Plan Files checkboxes | number[] | Selected file catalog ids, validated + deduped, ≤ 16 |
| `treatmentNotes` | Additional treatment notes textarea | string | ≤ 1200 chars |
| `tests` | Recommend Tests checkboxes | string[] | Slug ids from the test catalog (`cbc`, `cmp`, `celiac`, `fecal_calprotectin`) |
| `procedures` | Recommended Procedures checkboxes | string[] | Slug ids from the procedure catalog (`colonoscopy`, `egd`, `abdominal_ultrasound`) |
| `medications` | Current Medications rows | `{ name, dosage, frequency }[]` | ≤ 12 rows, each field ≤ 200 chars; a row with no `name` is dropped |
| `generatedAt` | — | ISO timestamp | Generation time |

### Status state machine

```
            ┌──────────────────────────────────────────────┐
            ▼                                              │
[create] ─► draft ─► submitted ─► under_review ─► completed ─► closed
                      ▲                              │
                      └─── (rare: re-edit drops back to draft) ──┘
```

Only API routes mutate `status`; the client never writes it directly.

## `pcp_cases/{caseId}/about/data` — Step 1 (10 fields)

| # | Field | Type | Required | Enum / constraint | Source on the form |
|---|---|---|---|---|---|
| 1 | `fullLegalName` | string | yes | 1–120 chars | "Full legal name" |
| 2 | `age` | int | yes | 0–120 | "Age" |
| 3 | `gender` | string | yes | `female` \| `male` \| `non_binary` \| `prefer_not_to_say` \| `other` | "Gender" select |
| 4 | `mobile` | string | yes | E.164-ish; digits ≥ 7 | "Mobile or home phone" |
| 5 | `email` | string | yes | RFC-5322 lite, lowercased on save | "Email" |
| 6 | `insuranceCarrier` | string | no | ≤ 80 chars | "Insurance carrier" |
| 7 | `policyId` | string | no | ≤ 60 chars | "Policy ID" |
| 8 | `groupName` | string | no | ≤ 80 chars | "Group name" |
| 9 | `effectiveDate` | ISO date string (`YYYY-MM-DD`) | no | — | "Effective date" |
| 10 | `insuranceCards` | map | no | see sub-shape below | "Front side" + "Back side" upload tiles |

Sub-shape for field 10:

```ts
insuranceCards: {
  front: { fileId: string; storagePath: string; uploadedAt: ISOTimestamp } | null,
  back:  { fileId: string; storagePath: string; uploadedAt: ISOTimestamp } | null,
}
```

`fileId` references a doc inside `pcp_cases/{caseId}/documents/{fileId}` with
`kind === 'insurance_card_front'` (or `_back`). Storing both the `fileId` and
the `storagePath` denormalizes the upload so the About form renders without a
join.

Housekeeping fields (on every group doc): `updatedAt`, `updatedByUserId`.

## `pcp_cases/{caseId}/health/data` — Step 2 (8 fields)

| # | Field | Type | Required | Enum / constraint | Notes |
|---|---|---|---|---|---|
| 1 | `inboxMessage` | string | yes | 1–4000 chars | The existing speech-to-text target textarea |
| 2 | `allergies` | string | no | ≤ 1000 chars | Free text; we accept comma-separated lists today, can normalize later |
| 3 | `currentMedications` | string | no | ≤ 1000 chars | Free text |
| 4 | `existingConditions` | string | no | ≤ 1000 chars | Free text |
| 5 | `recentTestsOrProcedures` | string | no | ≤ 1000 chars | Free text |
| 6 | `familyHistory` | string | no | ≤ 1000 chars | Free text |
| 7 | `lifestyleNotes` | string | no | ≤ 1000 chars | Diet / smoking / alcohol / activity |
| 8 | `urgencyLevel` | string | yes | `routine` \| `urgent` \| `emergency` | Drives sorting on the GI specialist's side |

Plus housekeeping: `updatedAt`, `updatedByUserId`, and an optional
`aiSymptomSummary` (string, ≤ 2000 chars) populated by a future AI pass — kept
here rather than on the root so the root stays small.

## `pcp_cases/{caseId}/documents/{fileId}` — Step 3 (one doc per file)

Firestore holds **metadata only**. The file bytes live in Firebase Storage at
the deterministic path listed below.

| Field | Type | Required | Enum / constraint | Notes |
|---|---|---|---|---|
| `fileName` | string | yes | 1–255 chars | Original name as uploaded |
| `contentType` | string | yes | MIME type | e.g. `application/pdf`, `image/jpeg` |
| `sizeBytes` | int | yes | ≤ 26_214_400 (25 MB) | Enforced server-side |
| `storagePath` | string | yes | `pcp_cases/{caseId}/documents/{fileId}/{fileName}` | Stable; never reused |
| `downloadUrl` | string \| null | no | Signed URL or null | Cached; null until first generated |
| `downloadUrlExpiresAt` | ISO timestamp \| null | no | — | If we cache signed URLs |
| `kind` | string | yes | `lab` \| `imaging` \| `note` \| `insurance_card_front` \| `insurance_card_back` \| `other` | Drives icon + grouping |
| `uploadedAt` | ISO timestamp | yes | — | |
| `uploadedByUserId` | string | yes | — | FK → `pcp_users` |
| `aiSummary` | string \| null | no | ≤ 2000 chars | From the post-upload AI pass |
| `aiSummaryGeneratedAt` | ISO timestamp \| null | no | — | |

`fileId` is an auto-generated Firestore push ID (matching the parent `caseId`
style).

## Enums (one place to look)

| Enum | Values | Used on |
|---|---|---|
| `caseStatus` | `draft`, `submitted`, `under_review`, `completed`, `closed` | `pcp_cases.status` |
| `gender` | `female`, `male`, `non_binary`, `prefer_not_to_say`, `other` | `about.gender` |
| `urgencyLevel` | `routine`, `urgent`, `emergency` | `health.urgencyLevel` |
| `documentKind` | `lab`, `imaging`, `note`, `insurance_card_front`, `insurance_card_back`, `other` | `documents.{fileId}.kind` |

## Ownership / security model

- Every root doc carries `ownerUserId`. Subcollection writes inherit ownership
  via the path (the parent's `ownerUserId` is authoritative).
- Until proper Firestore rules are deployed, **all reads/writes go through API
  routes**. Each route runs `await readSessionUserId()` (see
  `src/lib/auth.ts`), reads the parent case to check `ownerUserId`, and
  refuses the request on mismatch — same pattern as the existing auth routes.
- Once rules are deployed (recommended):
  `match /pcp_cases/{caseId} { allow read, write: if request.auth.uid == resource.data.ownerUserId; }`
  and a cascading rule for subcollections that resolves the parent's owner
  via `get(/databases/$(database)/documents/pcp_cases/$(caseId)).data.ownerUserId`.

## Indexes

- Composite: `pcp_cases` `(ownerUserId ASC, createdAt DESC)` — backs the
  dashboard "Recent requests" table. Firestore will prompt to create it on
  first query; commit it to `firestore.indexes.json` when we deploy.
- No index collection (no global uniqueness needed at case level — a user can
  have many cases). `shortCode` is unique *per user* and is generated with
  retry-on-collision in the API route.

## Storage layout (Firebase Storage)

Bucket: `aigicare-hipaa.firebasestorage.app` (already in `.env.local`).

```
/pcp_cases/{caseId}/documents/{fileId}/{filename}
```

Insurance card front and back use the same convention; their `fileId` is
referenced from `about/data.insuranceCards.front.fileId` and `.back.fileId`.

## Migration plan (for follow-up work)

Add `scripts/migrations/002-init-pcp-cases.mjs`, modelled on
`scripts/migrations/001-init-pcp-users.mjs`:

1. Write `_schema` docs at `pcp_cases/_schema`,
   `pcp_cases/_schema/about/data`, `pcp_cases/_schema/health/data`, and
   `pcp_cases/_schema/documents/_schema` describing every field listed above.
2. No backfill (no existing cases yet).
3. Record the result in `pcp_migrations/002-init-pcp-cases`.

The corresponding API routes (also follow-up work):

- `POST /api/cases` → create draft, return `{ caseId }`
- `GET /api/cases` → list current user's cases
- `GET /api/cases/{id}` → fetch root + subcollections
- `PATCH /api/cases/{id}/about` → upsert `about/data`
- `PATCH /api/cases/{id}/health` → upsert `health/data`
- `POST /api/cases/{id}/documents` → request signed upload URL + create metadata doc
- `DELETE /api/cases/{id}/documents/{fileId}`
- `POST /api/cases/{id}/submit` → transition `draft` → `submitted`
