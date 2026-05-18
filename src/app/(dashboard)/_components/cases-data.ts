export type PillVariant = "amber" | "rose" | "sky" | "slate" | "emerald";

export type CaseRecord = {
  id: string;
  name: string;
  initials: string;
  mrn: string;
  demo: string;
  dob: string;
  status: string;
  statusVariant: PillVariant;
  updated: string;
  shortUpdated: string;
  condition: string;
  aiFirstSummary: string;
  avatarBg: string;
};

export const CASES: CaseRecord[] = [
  {
    id: "case-1",
    name: "Sarah K. Mercer",
    initials: "SK",
    mrn: "#MRN-8829-001",
    demo: "25 yrs • Female",
    dob: "1999-02-16",
    status: "Pending review",
    statusVariant: "amber",
    updated: "Updated Apr 2, 2026",
    shortUpdated: "Apr 2",
    condition: "Active case",
    avatarBg:
      "linear-gradient(145deg, #6366f1 0%, #4338ca 45%, #024d9c 100%)",
    aiFirstSummary:
      "Liver chemistries suggest a predominantly conjugated hyperbilirubin pattern with total bilirubin elevation out of proportion to mild transaminase changes.",
  },
  {
    id: "case-2",
    name: "James Otis",
    initials: "JO",
    mrn: "#MRN-7712-442",
    demo: "58 yrs • Male",
    dob: "1967-11-03",
    status: "In review",
    statusVariant: "sky",
    updated: "Updated Mar 28, 2026",
    shortUpdated: "Mar 28",
    condition: "Active case",
    avatarBg:
      "linear-gradient(145deg, #0ea5e9 0%, #0369a1 50%, #1e3a8a 100%)",
    aiFirstSummary:
      "Cardiovascular risk is driven by long-standing hypertension and dyslipidemia, with recent stress testing showing ECG changes that warrant correlation with symptoms, prior studies, and functional capacity.",
  },
  {
    id: "case-3",
    name: "Maria Lopez",
    initials: "ML",
    mrn: "#MRN-6601-118",
    demo: "41 yrs • Female",
    dob: "1984-06-21",
    status: "Closed",
    statusVariant: "slate",
    updated: "Updated Mar 15, 2026",
    shortUpdated: "Mar 15",
    condition: "Closed",
    avatarBg:
      "linear-gradient(145deg, #14b8a6 0%, #0d9488 45%, #0369a1 100%)",
    aiFirstSummary:
      "Asthma has remained well controlled on the current controller regimen, with stable peak flow trends and no pattern of rescue inhaler overuse in the documented monitoring window.",
  },
  {
    id: "case-4",
    name: "Ethan Park",
    initials: "EP",
    mrn: "#MRN-5540-903",
    demo: "33 yrs • Male",
    dob: "1992-09-08",
    status: "Active",
    statusVariant: "emerald",
    updated: "Updated Apr 6, 2026",
    shortUpdated: "Apr 6",
    condition: "Active case",
    avatarBg:
      "linear-gradient(145deg, #f97316 0%, #ea580c 40%, #b91c1c 100%)",
    aiFirstSummary:
      "Glycemic indicators are consistent with new-onset dysglycemia in the setting of elevated BMI, sedentary work demands, and family history elements that amplify cardiometabolic risk.",
  },
  {
    id: "case-5",
    name: "Priya Shah",
    initials: "PS",
    mrn: "#MRN-4418-221",
    demo: "67 yrs • Female",
    dob: "1958-04-30",
    status: "Pending review",
    statusVariant: "amber",
    updated: "Updated Apr 1, 2026",
    shortUpdated: "Apr 1",
    condition: "Active case",
    avatarBg:
      "linear-gradient(145deg, #a855f7 0%, #7c3aed 45%, #4f46e5 100%)",
    aiFirstSummary:
      "Skeletal fragility risk is elevated by a history of vertebral fracture together with a documented interval without anti-resorptive or anabolic therapy and an overdue dual-energy X-ray absorptiometry study.",
  },
];

export const GI_USERS = [
  "Dr. Ayaan Gupta",
  "Dr. Nisha Verma",
  "Dr. Rohan Malik",
  "Dr. Priya Nair",
  "Dr. Karan Iyer",
  "Dr. Meera Singh",
];
