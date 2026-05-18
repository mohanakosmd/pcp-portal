export type ReportRow = {
  caseId: string;
  reportName: string;
  patient: string;
  dob: string;
  priority: string;
  summary: string;
  recommendations: string[];
};

export const REPORTS: ReportRow[] = [
  {
    caseId: "#MED-7721-RX",
    reportName: "Final Case Report",
    patient: "Ava Thompson",
    dob: "1998-02-16",
    priority: "Medium Priority (6.4 / 10)",
    summary:
      "Comprehensive review completed. Vitals and labs are stable overall with no immediate critical findings.",
    recommendations: [
      "Continue current medications",
      "Repeat CBC and CMP within 7 days",
      "Return for follow-up in 2 weeks",
    ],
  },
  {
    caseId: "#MED-7684-LB",
    reportName: "Final Case Report",
    patient: "Liam Carter",
    dob: "1998-02-16",
    priority: "Low Priority (3.2 / 10)",
    summary:
      "Lab trends reviewed against prior values. Most markers are within expected range with mild variance.",
    recommendations: [
      "Hydration and diet adherence",
      "Repeat fasting panel in 10 days",
      "Escalate if fatigue worsens",
    ],
  },
  {
    caseId: "#MED-7532-MR",
    reportName: "Final Case Report",
    patient: "Noah Bennett",
    dob: "1998-02-16",
    priority: "Medium Priority (5.8 / 10)",
    summary:
      "Medication list reconciled with pharmacy history. No high-risk interactions identified at this time.",
    recommendations: [
      "Continue current dosage plan",
      "Avoid duplicate OTC analgesics",
      "Report new side effects immediately",
    ],
  },
  {
    caseId: "#MED-7441-FP",
    reportName: "Final Case Report",
    patient: "Emma Richardson",
    dob: "1998-02-16",
    priority: "High Priority (7.9 / 10)",
    summary:
      "Follow-up schedule created by care team with milestone checks and escalation criteria.",
    recommendations: [
      "Attend scheduled follow-up visit",
      "Track symptoms daily",
      "Call clinic for worsening pain or breathing trouble",
    ],
  },
  {
    caseId: "#MED-7399-NT",
    reportName: "Final Case Report",
    patient: "Olivia Parker",
    dob: "1998-02-16",
    priority: "Low Priority (3.8 / 10)",
    summary:
      "Diet history and recent trends reviewed with recommendations for consistent meal timing.",
    recommendations: [
      "Increase hydration",
      "Reduce late-night meals",
      "Track trigger foods for 2 weeks",
    ],
  },
  {
    caseId: "#MED-7351-LF",
    reportName: "Liver Function Trend",
    patient: "Elijah Morgan",
    dob: "1998-02-16",
    priority: "Medium Priority (6.1 / 10)",
    summary:
      "Serial LFT values show mild persistent elevation without acute deterioration.",
    recommendations: [
      "Repeat LFT in 10 days",
      "Avoid alcohol and hepatotoxic OTC drugs",
      "Follow-up with GI clinic",
    ],
  },
  {
    caseId: "#MED-7310-ST",
    reportName: "Stool Analysis Report",
    patient: "Sophia Hayes",
    dob: "1998-02-16",
    priority: "Low Priority (2.9 / 10)",
    summary: "No critical infectious markers identified in current stool panel.",
    recommendations: [
      "Continue current treatment plan",
      "Maintain hydration",
      "Return if symptoms persist beyond 7 days",
    ],
  },
  {
    caseId: "#MED-7266-IM",
    reportName: "Inflammatory Marker Summary",
    patient: "Mason Cooper",
    dob: "1998-02-16",
    priority: "Medium Priority (5.4 / 10)",
    summary:
      "CRP/ESR trend shows gradual improvement with current therapy adherence.",
    recommendations: [
      "Continue anti-inflammatory regimen",
      "Monitor fatigue and fever",
      "Repeat markers at next visit",
    ],
  },
  {
    caseId: "#MED-7222-EN",
    reportName: "Endoscopy Preparation Note",
    patient: "Isabella Foster",
    dob: "1998-02-16",
    priority: "Low Priority (3.5 / 10)",
    summary:
      "Pre-procedure checklist reviewed and medication hold instructions documented.",
    recommendations: [
      "Follow bowel prep schedule",
      "Keep NPO as instructed",
      "Bring medication list on procedure day",
    ],
  },
  {
    caseId: "#MED-7188-AN",
    reportName: "Anemia Follow-up",
    patient: "Lucas Brooks",
    dob: "1998-02-16",
    priority: "Medium Priority (6.0 / 10)",
    summary:
      "Hemoglobin remains below baseline but stable with ongoing supplementation.",
    recommendations: [
      "Continue iron supplementation",
      "Repeat CBC in 2 weeks",
      "Report dizziness or palpitations urgently",
    ],
  },
  {
    caseId: "#MED-7144-BH",
    reportName: "Bowel Habit Monitoring",
    patient: "Mia Simmons",
    dob: "1998-02-16",
    priority: "Low Priority (4.0 / 10)",
    summary:
      "Daily bowel log suggests intermittent variability without alarm features.",
    recommendations: [
      "Maintain bowel diary",
      "Increase soluble fiber",
      "Escalate for blood in stool",
    ],
  },
  {
    caseId: "#MED-7098-US",
    reportName: "Ultrasound Summary",
    patient: "Ethan Powell",
    dob: "1998-02-16",
    priority: "Medium Priority (5.6 / 10)",
    summary:
      "Abdominal ultrasound reviewed; no acute obstructive pattern identified.",
    recommendations: [
      "Continue GI follow-up",
      "Correlate with latest labs",
      "Repeat imaging only if symptoms worsen",
    ],
  },
  {
    caseId: "#MED-7057-MT",
    reportName: "Medication Tolerance Check",
    patient: "Charlotte Reed",
    dob: "1998-02-16",
    priority: "Low Priority (3.6 / 10)",
    summary:
      "Current regimen tolerated well with no significant adverse effects reported.",
    recommendations: [
      "Continue prescribed regimen",
      "Take medication with meals as advised",
      "Report new side effects promptly",
    ],
  },
  {
    caseId: "#MED-7011-GI",
    reportName: "GI Specialist Coordination",
    patient: "James Watson",
    dob: "1998-02-16",
    priority: "Medium Priority (6.2 / 10)",
    summary:
      "Specialist recommendations integrated into care plan and follow-up timeline.",
    recommendations: [
      "Attend specialist visit",
      "Bring prior reports",
      "Review escalation precautions with care team",
    ],
  },
  {
    caseId: "#MED-6980-QR",
    reportName: "Quarterly Progress Review",
    patient: "Amelia Griffin",
    dob: "1998-02-16",
    priority: "Low Priority (4.4 / 10)",
    summary:
      "Quarterly review indicates overall improvement with stable symptom burden.",
    recommendations: [
      "Continue current plan",
      "Schedule routine follow-up",
      "Maintain symptom and diet logs",
    ],
  },
];

export type SymptomProfile = {
  presenting: string[];
  ai: string;
};

const SYMPTOM_PROFILES: Record<string, SymptomProfile> = {
  "#MED-7721-RX": {
    presenting: ["Abdominal Pain", "Nausea and Vomiting"],
    ai: "Pattern suggests gastritis flare with dehydration risk if intake remains low.",
  },
  "#MED-7684-LB": {
    presenting: ["Fatty Liver", "Anemia"],
    ai: "Lab trend indicates metabolic and iron-status monitoring should continue.",
  },
  "#MED-7532-MR": {
    presenting: ["IBS", "Change in Bowel Habits"],
    ai: "Symptoms align with intermittent IBS activity without acute red flags.",
  },
  "#MED-7441-FP": {
    presenting: ["Rectal Bleeding", "Constipation"],
    ai: "Needs close stool-pattern tracking and timely escalation if bleeding increases.",
  },
  "#MED-7399-NT": {
    presenting: ["Acid Reflux", "Difficulty Swallowing"],
    ai: "Meal timing and trigger-food review are likely to improve symptom control.",
  },
  "#MED-7351-LF": {
    presenting: ["Fatty Liver", "Jaundice"],
    ai: "Suggests liver-focused pathway with repeat LFT and imaging correlation.",
  },
  "#MED-7310-ST": {
    presenting: ["Diarrhea", "Abdominal Pain"],
    ai: "Current pattern favors supportive care unless duration or severity worsens.",
  },
  "#MED-7266-IM": {
    presenting: ["Crohn's Disease", "Diarrhea"],
    ai: "Inflammatory activity appears moderate and should be trended with symptoms.",
  },
  "#MED-7222-EN": {
    presenting: ["Upper Endoscopy", "Nausea and Vomiting"],
    ai: "Symptoms support procedure-readiness review and prep adherence checks.",
  },
  "#MED-7188-AN": {
    presenting: ["Anemia", "Fatigue"],
    ai: "Compatible with ongoing iron-deficiency recovery; monitor for dizziness.",
  },
  "#MED-7144-BH": {
    presenting: ["Change in Bowel Habits", "Constipation"],
    ai: "Likely functional bowel variability; continue hydration and fiber tracking.",
  },
  "#MED-7098-US": {
    presenting: ["Abdominal Pain", "Jaundice"],
    ai: "Requires imaging-linked clinical correlation for biliary/hepatic causes.",
  },
  "#MED-7057-MT": {
    presenting: ["Nausea and Vomiting", "Acid Reflux"],
    ai: "Could represent mild medication intolerance; monitor timing with doses.",
  },
  "#MED-7011-GI": {
    presenting: ["Rectal Bleeding", "Ulcerative Colitis"],
    ai: "Specialist pathway remains appropriate with active inflammation surveillance.",
  },
  "#MED-6980-QR": {
    presenting: ["Screening Colon", "Other Problem"],
    ai: "Overall trajectory improving; continue periodic review and symptom journaling.",
  },
};

const FALLBACK_PROFILE: SymptomProfile = {
  presenting: ["Abdominal Pain", "IBS"],
  ai: "AI intake suggests a non-urgent pattern; continue routine review and escalation precautions.",
};

export function getSymptomProfile(caseId: string): SymptomProfile {
  return SYMPTOM_PROFILES[caseId] ?? FALLBACK_PROFILE;
}
