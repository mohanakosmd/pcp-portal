// The fixed pick-lists behind the GI "Clinical Diagnosis & Plan" workspace:
//   - ASSESSMENT_PLAN_FILE_CATALOG — "Assessment & Plan Files" (Labs / Imaging /
//     Procedure / Diet & Lifestyle), numeric ids from the GI portal (AIGI:
//     src/component/admin/viewpatient.js `fileCategories`, stored on
//     `selected_final_note_file_ids`).
//   - RECOMMENDED_TEST_CATALOG / RECOMMENDED_PROCEDURE_CATALOG — the "Recommend
//     Tests" / "Recommended Procedures" checkbox lists, slug ids.
//
// Single source of truth in the PCP portal: gi-reports.ts renders GI-selected
// files from the file catalog, and the submit-time AI pass
// (api/cases/[caseId]/ai-summary) picks from all three. Keep in sync if the GI
// portal's catalogs change.

export type AssessmentPlanCatalogEntry = { id: number; label: string };
export type AssessmentPlanCatalogGroup = {
  category: string;
  files: AssessmentPlanCatalogEntry[];
};

export const ASSESSMENT_PLAN_FILE_CATALOG: AssessmentPlanCatalogGroup[] = [
  {
    category: "Labs",
    files: [
      { id: 5, label: "Basic Gastro Labs" },
      { id: 3, label: "Anemia Labs" },
      { id: 14, label: "Hepatic Labs" },
      { id: 19, label: "Stool Studies" },
    ],
  },
  {
    category: "Imaging",
    files: [
      { id: 1, label: "Abdominal CT" },
      { id: 2, label: "Abdominal US" },
      { id: 4, label: "Barium Studies" },
    ],
  },
  {
    category: "Procedure",
    files: [
      { id: 10, label: "EGD Order" },
      { id: 6, label: "Colon Order" },
      { id: 7, label: "Colonoscopy" },
      { id: 22, label: "Upper GI Endoscopy" },
      { id: 18, label: "Procedural Sedation" },
      { id: 8, label: "Colon Screening Guidelines" },
      { id: 21, label: "Telehealth Disclaimer" },
    ],
  },
  {
    category: "Diet & Lifestyle Modification",
    files: [
      { id: 23, label: "Weight Reducing Diet" },
      { id: 15, label: "High Fiber Diet" },
      { id: 13, label: "GERD and Lifestyle" },
      { id: 20, label: "Stress Management" },
      { id: 12, label: "FODMAP Diet" },
      { id: 11, label: "Fatty Liver" },
      { id: 9, label: "Diverticulosis" },
      { id: 17, label: "Irritable Bowel Syndrome" },
      { id: 16, label: "Inflammatory Bowel Disease" },
    ],
  },
];

/** Flat id → { label, category } lookup, derived once from the catalog. */
const CATALOG_BY_ID = new Map<number, { label: string; category: string }>();
for (const group of ASSESSMENT_PLAN_FILE_CATALOG) {
  for (const file of group.files) {
    CATALOG_BY_ID.set(file.id, { label: file.label, category: group.category });
  }
}

/** Every valid catalog id. */
export function assessmentPlanFileIds(): number[] {
  return [...CATALOG_BY_ID.keys()];
}

export function isKnownAssessmentPlanFileId(id: number): boolean {
  return CATALOG_BY_ID.has(id);
}

export type AssessmentPlanFileGroup = { category: string; files: string[] };

/**
 * Maps a list of selected note-file ids to label groups, in catalog order.
 * Unknown ids (a catalog the PCP portal hasn't caught up to) are surfaced under
 * an "Other" group as `Document #<id>` rather than dropped, so nothing the GI
 * selected silently disappears.
 */
export function groupAssessmentPlanFileIds(ids: number[]): AssessmentPlanFileGroup[] {
  if (ids.length === 0) return [];
  const idSet = new Set(ids);
  const groups: AssessmentPlanFileGroup[] = [];
  for (const cat of ASSESSMENT_PLAN_FILE_CATALOG) {
    const files: string[] = [];
    for (const f of cat.files) {
      if (idSet.has(f.id)) files.push(f.label);
    }
    if (files.length) groups.push({ category: cat.category, files });
  }
  const unknown = ids.filter((id) => !CATALOG_BY_ID.has(id));
  if (unknown.length) {
    groups.push({ category: "Other", files: unknown.map((id) => `Document #${id}`) });
  }
  return groups;
}

/**
 * The catalog rendered as a compact `id — label` list per category, for use in an
 * LLM prompt that must choose only from these ids.
 */
export function assessmentPlanCatalogPromptText(): string {
  return ASSESSMENT_PLAN_FILE_CATALOG.map((group) => {
    const lines = group.files.map((f) => `  ${f.id} — ${f.label}`).join("\n");
    return `${group.category}:\n${lines}`;
  }).join("\n");
}

// --- Recommend Tests / Recommended Procedures --------------------------------
// The two additional pick-lists in the GI "Clinical Diagnosis & Plan" workspace
// (screenshot: "Recommend Tests" and "Recommended Procedures"). Slug ids so the
// stored suggestion is stable regardless of label wording.

export type SlugCatalogEntry = { id: string; label: string };

export const RECOMMENDED_TEST_CATALOG: SlugCatalogEntry[] = [
  { id: "cbc", label: "Complete Blood Count (CBC)" },
  { id: "cmp", label: "Comprehensive Metabolic Panel" },
  { id: "celiac", label: "Celiac Serology" },
  { id: "fecal_calprotectin", label: "Fecal Calprotectin" },
];

export const RECOMMENDED_PROCEDURE_CATALOG: SlugCatalogEntry[] = [
  { id: "colonoscopy", label: "Colonoscopy" },
  { id: "egd", label: "Upper Endoscopy (EGD)" },
  { id: "abdominal_ultrasound", label: "Abdominal Ultrasound" },
];

/**
 * Resolves a model-supplied value to a known slug id, accepting either the id or
 * the label (case-insensitive) so a returned "Colonoscopy" maps to "colonoscopy".
 * Returns null when it matches nothing in the catalog.
 */
function resolveSlug(catalog: SlugCatalogEntry[], value: string): string | null {
  const v = value.trim().toLowerCase();
  if (!v) return null;
  for (const entry of catalog) {
    if (entry.id.toLowerCase() === v || entry.label.toLowerCase() === v) return entry.id;
  }
  return null;
}

export function resolveTestId(value: string): string | null {
  return resolveSlug(RECOMMENDED_TEST_CATALOG, value);
}

export function resolveProcedureId(value: string): string | null {
  return resolveSlug(RECOMMENDED_PROCEDURE_CATALOG, value);
}

/** Renders a slug catalog as `id — label` lines for an LLM prompt. */
export function slugCatalogPromptText(catalog: SlugCatalogEntry[]): string {
  return catalog.map((e) => `  ${e.id} — ${e.label}`).join("\n");
}
