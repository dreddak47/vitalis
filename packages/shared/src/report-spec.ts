/**
 * Generative report specification.
 *
 * The server compiles a `ReportSpec` from (records + profile + preferences).
 * The frontend is a *renderer*: it maps each section `kind` to a registered
 * React component and never hardcodes a layout. That is what makes the report
 * generative — two users with different ages, conditions and preferences get
 * structurally different reports from the same binary.
 */
import { z } from "zod";

/** Sections the compiler can emit. Each maps to a registered UI component. */
export const SECTION_KINDS = [
  "headline", // one-paragraph "state of your health" summary
  "risk_flags", // things that need attention now, ranked
  "lab_trends", // time-series of key labs for this persona
  "medication_list", // active/discontinued meds with interaction notes
  "medication_adherence", // schedule view + refill/duration warnings
  "vitals_chart", // BP/weight/HR trends
  "condition_timeline", // diagnosed conditions over time
  "allergy_alerts", // allergy list, shown prominently if severe
  "preventive_care", // age/sex-appropriate screening reminders
  "documents_digest", // what was ingested, review queue status
  "lifestyle_notes", // extracted lifestyle signals (sleep, activity, smoking)
] as const;
export type SectionKind = (typeof SECTION_KINDS)[number];

export const reportSectionSchema = z.object({
  id: z.string(),
  kind: z.enum(SECTION_KINDS),
  title: z.string(),
  /** Lower = rendered earlier. */
  priority: z.number(),
  /** Why this section was included — shown to the user for transparency. */
  rationale: z.string(),
  /** Section-specific payload; the owning component validates it. */
  props: z.record(z.unknown()),
});
export type ReportSection = z.infer<typeof reportSectionSchema>;

export const reportPersonaSchema = z.object({
  ageYears: z.number().nullable(),
  ageBand: z.enum(["pediatric", "adult", "older_adult", "unknown"]),
  activeConditions: z.array(z.string()),
  /** Tags driving section selection, e.g. "diabetic", "hypertensive". */
  tags: z.array(z.string()),
});
export type ReportPersona = z.infer<typeof reportPersonaSchema>;

export const reportSpecSchema = z.object({
  id: z.string(),
  userId: z.string(),
  generatedAt: z.string(),
  persona: reportPersonaSchema,
  sections: z.array(reportSectionSchema),
  disclaimer: z.string(),
});
export type ReportSpec = z.infer<typeof reportSpecSchema>;

export const REPORT_DISCLAIMER =
  "This report is generated from your uploaded documents by an automated system. " +
  "It is not medical advice and may contain extraction errors. " +
  "Verify important values against the source documents and consult your clinician.";
