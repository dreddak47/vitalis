import {
  REPORT_DISCLAIMER,
  type DisplayPreferences,
  type DocumentRecord,
  type HealthRecords,
  type LabResultRecord,
  type ReportPersona,
  type ReportSection,
  type ReportSpec,
  type SectionKind,
  type UserProfile,
} from "@vitalis/shared";
import { ageYears, newId, nowIso } from "../util/helpers.js";

/**
 * The generative report compiler — the piece that makes Vitalis a
 * *personalized* product rather than a static dashboard.
 *
 * Inputs:
 *   facts        — verified structured records from the ingestion pipeline
 *   profile      — age, sex (drive persona rules)
 *   preferences  — user's explicit display/focus choices
 *   documents    — ingestion state (digest section, review queue)
 *
 * Output: a ReportSpec — an ordered list of typed sections the frontend
 * renders with registered components. The compiler decides WHICH sections
 * exist, their ORDER, and their PROPS; the web app never decides layout.
 *
 * Every section carries a `rationale` shown to the user ("why am I seeing
 * this?") — transparency is a product feature in health software.
 */

// ---------------------------------------------------------------------------
// Persona derivation
// ---------------------------------------------------------------------------

const CONDITION_TAGS: Array<[RegExp, string]> = [
  [/diabetes/i, "diabetic"],
  [/hypertension/i, "hypertensive"],
  [/hypothyroid/i, "hypothyroid"],
  [/dyslipid|hyperlipid|cholesterol/i, "dyslipidemia"],
  [/anemia|anaemia/i, "anemic"],
];

function derivePersona(profile: UserProfile, records: HealthRecords): ReportPersona {
  const activeConditions = records.conditions
    .filter((c) => c.status !== "resolved")
    .map((c) => c.name);

  const age = profile.dob ? ageYears(profile.dob) : null;
  const ageBand: ReportPersona["ageBand"] =
    age === null ? "unknown" : age < 18 ? "pediatric" : age >= 60 ? "older_adult" : "adult";

  const tags = new Set<string>();
  for (const name of activeConditions) {
    for (const [re, tag] of CONDITION_TAGS) if (re.test(name)) tags.add(tag);
  }
  for (const lab of records.labResults) {
    if (
      lab.analyte === "hba1c" &&
      lab.value !== null &&
      lab.value >= 5.7 &&
      !tags.has("diabetic")
    ) {
      tags.add("prediabetes_risk");
    }
    if (lab.analyte === "ldl_c" && lab.flag === "high") tags.add("dyslipidemia");
  }

  return { ageYears: age, ageBand, activeConditions, tags: [...tags] };
}

// ---------------------------------------------------------------------------
// Rule framework
// ---------------------------------------------------------------------------

interface RuleContext {
  profile: UserProfile;
  preferences: DisplayPreferences;
  persona: ReportPersona;
  records: HealthRecords;
  documents: DocumentRecord[];
}

interface Rule {
  kind: SectionKind;
  /** Base priority (lower = earlier); focus-area membership shifts it down. */
  basePriority: number;
  /** Which focus area (if any) boosts this section. */
  focusArea?: DisplayPreferences["focusAreas"][number];
  /** Gate: should this section exist at all for this user? */
  applies(ctx: RuleContext): boolean;
  /** Build the props payload. Only called when applies() is true. */
  build(ctx: RuleContext): Record<string, unknown>;
  /** Plain-language explanation surfaced in the UI. */
  rationale(ctx: RuleContext): string;
}

function latestLab(records: HealthRecords, analyte: string): LabResultRecord | null {
  const series = records.labResults
    .filter((l) => l.analyte === analyte && l.measuredAt)
    .sort((a, b) => (b.measuredAt ?? "").localeCompare(a.measuredAt ?? ""));
  return series[0] ?? null;
}

function labsForPersona(persona: ReportPersona): string[] {
  // What *this* person's charts should show — the core personalization.
  const keys = new Set<string>();
  if (persona.tags.includes("diabetic") || persona.tags.includes("prediabetes_risk")) {
    keys.add("hba1c");
    keys.add("fasting_glucose");
  }
  if (persona.tags.includes("dyslipidemia") || persona.ageBand === "older_adult") {
    keys.add("ldl_c");
    keys.add("hdl_c");
    keys.add("triglycerides");
  }
  if (persona.tags.includes("hypothyroid")) keys.add("tsh");
  if (persona.tags.includes("anemic")) keys.add("hemoglobin");
  if (keys.size === 0) keys.add("hba1c"); // default: metabolically useful
  return [...keys];
}

function language(style: DisplayPreferences["language"], plain: string, clinical: string): string {
  return style === "clinical" ? clinical : plain;
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

const rules: Rule[] = [
  {
    kind: "headline",
    basePriority: 0,
    applies: () => true,
    rationale: () => "Always shown: a one-paragraph orientation to your current record.",
    build: (ctx) => {
      const { records, persona } = ctx;
      const activeMeds = records.medications.filter((m) => m.status === "active").length;
      const abnormal = records.labResults.filter((l) => l.flag === "high" || l.flag === "low");
      const parts: string[] = [];
      parts.push(
        persona.ageYears !== null
          ? `Health summary for a ${persona.ageYears}-year-old tracked by Vitalis.`
          : "Health summary generated from your uploaded documents."
      );
      if (persona.activeConditions.length > 0) {
        parts.push(
          language(
            ctx.preferences.language,
            `You are managing: ${persona.activeConditions.join(", ")}.`,
            `Active problem list: ${persona.activeConditions.join(", ")}.`
          )
        );
      }
      parts.push(
        `${activeMeds} active medication${activeMeds === 1 ? "" : "s"}, ` +
          `${abnormal.length} lab result${abnormal.length === 1 ? "" : "s"} outside reference range, ` +
          `${ctx.documents.length} documents on file.`
      );
      return { paragraphs: parts, tone: abnormal.length > 2 ? "attention" : "neutral" };
    },
  },
  {
    kind: "risk_flags",
    basePriority: 1,
    applies: (ctx) =>
      ctx.records.labResults.some((l) => l.flag === "high" || l.flag === "low" || l.flag === "critical") ||
      ctx.records.allergies.some((a) => a.severity === "severe"),
    rationale: () =>
      "Shown first because something in your record needs attention before routine tracking.",
    build: (ctx) => {
      const flags = ctx.records.labResults
        .filter((l) => l.flag && l.flag !== "normal")
        .map((l) => ({
          label: l.displayName,
          detail: `${l.value ?? "?"} ${l.unit ?? ""}`.trim() +
            (l.referenceHigh !== null || l.referenceLow !== null
              ? ` (reference ${l.referenceLow ?? "–"}–${l.referenceHigh ?? "–"})`
              : ""),
          severity: l.flag,
          measuredAt: l.measuredAt,
        }));
      for (const a of ctx.records.allergies.filter((a) => a.severity === "severe")) {
        flags.push({
          label: `Severe allergy: ${a.substance}`,
          detail: a.reaction ?? "reaction not recorded",
          severity: "critical",
          measuredAt: null,
        });
      }
      return { flags };
    },
  },
  {
    kind: "lab_trends",
    basePriority: 3,
    focusArea: "metabolic",
    applies: (ctx) => ctx.preferences.showTrends && ctx.records.labResults.length > 0,
    rationale: (ctx) =>
      labsForPersona(ctx.persona).length > 1
        ? `These labs were chosen for your profile (${ctx.persona.tags.join(", ") || "general"}), not a generic panel.`
        : "Trend view of your available lab history.",
    build: (ctx) => {
      const keys = labsForPersona(ctx.persona);
      const series = keys
        .map((analyte) => {
          const points = ctx.records.labResults
            .filter((l) => l.analyte === analyte && l.value !== null && l.measuredAt)
            .sort((a, b) => (a.measuredAt ?? "").localeCompare(b.measuredAt ?? ""))
            .map((l) => ({
              date: l.measuredAt,
              value: l.value,
              flag: l.flag,
            }));
          const ref = ctx.records.labResults.find((l) => l.analyte === analyte);
          return {
            analyte,
            displayName: ref?.displayName ?? analyte,
            unit: ref?.unit ?? null,
            referenceLow: ctx.preferences.showReferenceRanges ? (ref?.referenceLow ?? null) : null,
            referenceHigh: ctx.preferences.showReferenceRanges ? (ref?.referenceHigh ?? null) : null,
            points,
          };
        })
        .filter((s) => s.points.length > 0);
      return { series };
    },
  },
  {
    kind: "medication_list",
    basePriority: 4,
    focusArea: "medications",
    applies: (ctx) => ctx.records.medications.length > 0,
    rationale: () => "Your current and past medications, as extracted from prescriptions and notes.",
    build: (ctx) => ({
      active: ctx.records.medications
        .filter((m) => m.status === "active")
        .map((m) => ({
          id: m.id,
          drugName: m.drugName,
          dose: m.dose,
          frequency: m.frequency,
          instructions: m.instructions,
          verification: m.verification,
        })),
      discontinued: ctx.records.medications
        .filter((m) => m.status === "discontinued")
        .map((m) => ({ id: m.id, drugName: m.drugName, endDate: m.endDate })),
      needsReview: ctx.records.medications.filter((m) => m.verification === "unverified").length,
    }),
  },
  {
    kind: "medication_adherence",
    basePriority: 5,
    focusArea: "medications",
    applies: (ctx) =>
      ctx.records.medications.some((m) => m.status === "active" && m.startDate) &&
      ctx.preferences.detailLevel !== "at_a_glance",
    rationale: () =>
      "You have active medications with dosing schedules — this view helps track what to take when, and flags courses nearing their end date.",
    build: (ctx) => {
      const schedule = ctx.records.medications
        .filter((m) => m.status === "active")
        .map((m) => ({
          drugName: m.drugName,
          frequency: m.frequency,
          dose: m.dose,
          endDate: m.endDate,
          endingSoon:
            m.endDate !== null &&
            new Date(m.endDate).getTime() - Date.now() < 7 * 86_400_000,
        }));
      return { schedule };
    },
  },
  {
    kind: "vitals_chart",
    basePriority: 6,
    focusArea: "vitals",
    applies: (ctx) => ctx.preferences.showTrends && ctx.records.vitals.length > 0,
    rationale: () => "Recorded blood pressure, weight and other measurements over time.",
    build: (ctx) => {
      const groups = new Map<string, Array<{ date: string | null; value: number | null; secondary: number | null; unit: string | null }>>();
      for (const v of ctx.records.vitals) {
        const arr = groups.get(v.kind) ?? [];
        arr.push({ date: v.measuredAt, value: v.value, secondary: v.valueSecondary, unit: v.unit });
        groups.set(v.kind, arr);
      }
      return {
        groups: [...groups.entries()].map(([kind, points]) => ({
          kind,
          points: points.sort((a, b) => (a.date ?? "").localeCompare(b.date ?? "")),
        })),
      };
    },
  },
  {
    kind: "condition_timeline",
    basePriority: 7,
    applies: (ctx) => ctx.records.conditions.length > 0,
    rationale: () => "When each condition entered your record — useful for spotting what came first.",
    build: (ctx) => ({
      conditions: ctx.records.conditions
        .map((c) => ({
          name: c.name,
          icd10: c.icd10,
          status: c.status,
          diagnosedAt: c.diagnosedAt,
        }))
        .sort((a, b) => (a.diagnosedAt ?? "").localeCompare(b.diagnosedAt ?? "")),
    }),
  },
  {
    kind: "allergy_alerts",
    basePriority: 8, // severe allergies get re-ranked ahead by the ranker below
    focusArea: "allergies",
    applies: (ctx) => ctx.records.allergies.length > 0,
    rationale: () => "Drug and other allergies must be visible before any new medication decision.",
    build: (ctx) => ({
      allergies: ctx.records.allergies.map((a) => ({
        substance: a.substance,
        reaction: a.reaction,
        severity: a.severity,
      })),
      hasSevere: ctx.records.allergies.some((a) => a.severity === "severe"),
    }),
  },
  {
    kind: "preventive_care",
    basePriority: 9,
    focusArea: "preventive_care",
    applies: (ctx) => ctx.persona.ageYears !== null || ctx.persona.activeConditions.length > 0,
    rationale: (ctx) =>
      `Screening suggestions for your ${ctx.persona.ageBand.replace("_", " ")} profile` +
      (ctx.persona.tags.length > 0 ? ` with ${ctx.persona.tags.join(", ")}.` : "."),
    build: (ctx) => {
      const items: Array<{ item: string; reason: string; overdue: boolean }> = [];
      const age = ctx.persona.ageYears;
      const hasLab = (a: string, withinDays: number) => {
        const latest = latestLab(ctx.records, a);
        if (!latest?.measuredAt) return false;
        return Date.now() - new Date(latest.measuredAt).getTime() < withinDays * 86_400_000;
      };
      if (ctx.persona.tags.includes("diabetic")) {
        items.push({ item: "HbA1c every 3–6 months", reason: "active diabetes", overdue: !hasLab("hba1c", 183) });
        items.push({ item: "Annual dilated eye exam", reason: "diabetic retinopathy screening", overdue: true });
      }
      if (age !== null && age >= 40) {
        items.push({ item: "Lipid panel", reason: "cardiovascular risk screening (age ≥ 40)", overdue: !hasLab("ldl_c", 365) });
      }
      if (age !== null && age >= 45) {
        items.push({ item: "Colorectal cancer screening", reason: "USPSTF recommendation from age 45", overdue: true });
      }
      if (ctx.profile.sex === "female" && age !== null && age >= 40) {
        items.push({ item: "Mammography", reason: "breast cancer screening (age ≥ 40)", overdue: true });
      }
      if (ctx.persona.tags.includes("hypothyroid")) {
        items.push({ item: "TSH check", reason: "thyroid monitoring on/after medication", overdue: !hasLab("tsh", 365) });
      }
      return { items };
    },
  },
  {
    kind: "documents_digest",
    basePriority: 10,
    applies: (ctx) => ctx.documents.length > 0,
    rationale: () => "What the system has ingested, and which extractions still await your review.",
    build: (ctx) => ({
      total: ctx.documents.length,
      byKind: ctx.documents.reduce<Record<string, number>>((acc, d) => {
        acc[d.kind] = (acc[d.kind] ?? 0) + 1;
        return acc;
      }, {}),
      needsReview: ctx.documents
        .filter((d) => d.status === "needs_review")
        .map((d) => ({ id: d.id, title: d.title })),
      failed: ctx.documents.filter((d) => d.status === "failed").length,
    }),
  },
  {
    kind: "lifestyle_notes",
    basePriority: 11,
    focusArea: "mental_health",
    applies: (ctx) => ctx.documents.some((d) => d.kind === "voice_memo"),
    rationale: () => "Signals captured from your voice memos (self-reported, lower confidence).",
    build: (ctx) => {
      const notes = ctx.records.conditions
        .filter((c) => {
          const doc = ctx.documents.find((d) => d.id === c.documentId);
          return doc?.kind === "voice_memo";
        })
        .map((c) => ({ note: c.name, date: c.diagnosedAt }));
      return { notes };
    },
  },
];

// ---------------------------------------------------------------------------
// Compiler
// ---------------------------------------------------------------------------

export function compileReport(
  userId: string,
  profile: UserProfile,
  preferences: DisplayPreferences,
  records: HealthRecords,
  documents: DocumentRecord[]
): ReportSpec {
  const persona = derivePersona(profile, records);
  const ctx: RuleContext = { profile, preferences, persona, records, documents };

  let sections: ReportSection[] = rules
    .filter((r) => r.applies(ctx))
    .map((r) => {
      let priority = r.basePriority;
      // Explicit user focus areas pull a section toward the top.
      if (r.focusArea && preferences.focusAreas.includes(r.focusArea)) priority -= 2;
      // Severe allergies are always surfaced early.
      if (r.kind === "allergy_alerts" && records.allergies.some((a) => a.severity === "severe")) {
        priority = 2;
      }
      return {
        id: `${r.kind}`,
        kind: r.kind,
        title: SECTION_TITLES[r.kind],
        priority,
        rationale: r.rationale(ctx),
        props: r.build(ctx),
      };
    });

  // Preference: "at_a_glance" trims to the essentials.
  if (preferences.detailLevel === "at_a_glance") {
    const keep: SectionKind[] = ["headline", "risk_flags", "lab_trends", "medication_list"];
    sections = sections.filter((s) => keep.includes(s.kind));
  }

  sections.sort((a, b) => a.priority - b.priority);

  return {
    id: newId(),
    userId,
    generatedAt: nowIso(),
    persona,
    sections,
    disclaimer: REPORT_DISCLAIMER,
  };
}

const SECTION_TITLES: Record<SectionKind, string> = {
  headline: "Your Health at a Glance",
  risk_flags: "Needs Attention",
  lab_trends: "Lab Trends",
  medication_list: "Medications",
  medication_adherence: "Medication Schedule",
  vitals_chart: "Vitals Over Time",
  condition_timeline: "Condition Timeline",
  allergy_alerts: "Allergies",
  preventive_care: "Preventive Care",
  documents_digest: "Documents & Review Queue",
  lifestyle_notes: "Notes From Your Voice Memos",
};
