import type { ReportSection, ReportSpec } from "@vitalis/shared";

/**
 * Server-side HTML renderer for downloadable reports.
 *
 * The web app renders a ReportSpec with React components; this renderer
 * produces a faithful, self-contained static HTML mirror for the "Download"
 * button (print-to-PDF ready: one file, inline styles, no scripts, no network).
 * Keeping both renderers means the downloadable artifact is compiled *in our
 * system* — not screenshotted client-side.
 */

const esc = (s: unknown): string =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const num = (v: unknown): string =>
  typeof v === "number" ? (Number.isInteger(v) ? String(v) : v.toFixed(1)) : esc(v);

function sectionBody(section: ReportSection): string {
  const p = section.props as Record<string, any>; // props were built by the compiler
  switch (section.kind) {
    case "headline":
      return (p.paragraphs as string[]).map((t) => `<p>${esc(t)}</p>`).join("");
    case "risk_flags":
      return `<table><tr><th>Item</th><th>Detail</th><th>Severity</th><th>Date</th></tr>${(
        p.flags as any[]
      )
        .map(
          (f) =>
            `<tr><td>${esc(f.label)}</td><td>${esc(f.detail)}</td><td class="sev-${esc(f.severity)}">${esc(
              f.severity
            )}</td><td>${esc(f.measuredAt ?? "")}</td></tr>`
        )
        .join("")}</table>`;
    case "lab_trends":
      return (p.series as any[])
        .map((s) => {
          const rows = s.points
            .map(
              (pt: any) =>
                `<tr><td>${esc(pt.date ?? "")}</td><td>${num(pt.value)} ${esc(s.unit ?? "")}</td><td>${esc(
                  pt.flag ?? ""
                )}</td></tr>`
            )
            .join("");
          const ref =
            s.referenceLow !== null || s.referenceHigh !== null
              ? `<span class="muted">reference ${s.referenceLow ?? "–"}–${s.referenceHigh ?? "–"} ${esc(
                  s.unit ?? ""
                )}</span>`
              : "";
          return `<h4>${esc(s.displayName)} ${ref}</h4><table><tr><th>Date</th><th>Value</th><th>Flag</th></tr>${rows}</table>`;
        })
        .join("");
    case "medication_list": {
      const act = (p.active as any[])
        .map(
          (m) =>
            `<tr><td>${esc(m.drugName)}</td><td>${
              m.dose ? `${num(m.dose.amount)} ${esc(m.dose.unit)}` : ""
            }</td><td>${esc(m.frequency ?? "")}</td><td>${esc(m.instructions ?? "")}</td><td>${esc(
              m.verification
            )}</td></tr>`
        )
        .join("");
      const dis = (p.discontinued as any[])
        .map((m) => `<li>${esc(m.drugName)} (ended ${esc(m.endDate ?? "unknown")})</li>`)
        .join("");
      return (
        `<h4>Active</h4><table><tr><th>Drug</th><th>Dose</th><th>Frequency</th><th>Instructions</th><th>Verification</th></tr>${act}</table>` +
        (dis ? `<h4>Discontinued</h4><ul>${dis}</ul>` : "") +
        (p.needsReview > 0
          ? `<p class="muted">${p.needsReview} entr${p.needsReview === 1 ? "y" : "ies"} awaiting your verification.</p>`
          : "")
      );
    }
    case "medication_adherence":
      return `<table><tr><th>Drug</th><th>Schedule</th><th>Dose</th><th>Note</th></tr>${(
        p.schedule as any[]
      )
        .map(
          (s) =>
            `<tr><td>${esc(s.drugName)}</td><td>${esc(s.frequency ?? "")}</td><td>${
              s.dose ? `${num(s.dose.amount)} ${esc(s.dose.unit)}` : ""
            }</td><td>${s.endingSoon ? '<span class="sev-high">course ends within a week</span>' : ""}</td></tr>`
        )
        .join("")}</table>`;
    case "vitals_chart":
      return (p.groups as any[])
        .map(
          (g) =>
            `<h4>${esc(g.kind.replace(/_/g, " "))}</h4><table><tr><th>Date</th><th>Value</th></tr>${(
              g.points as any[]
            )
              .map(
                (pt: any) =>
                  `<tr><td>${esc(pt.date ?? "")}</td><td>${num(pt.value)}${
                    pt.secondary !== null && pt.secondary !== undefined ? `/${num(pt.secondary)}` : ""
                  } ${esc(pt.unit ?? "")}</td></tr>`
              )
              .join("")}</table>`
        )
        .join("");
    case "condition_timeline":
      return `<table><tr><th>Condition</th><th>ICD-10</th><th>Status</th><th>Since</th></tr>${(
        p.conditions as any[]
      )
        .map(
          (c) =>
            `<tr><td>${esc(c.name)}</td><td>${esc(c.icd10 ?? "")}</td><td>${esc(c.status ?? "")}</td><td>${esc(
              c.diagnosedAt ?? ""
            )}</td></tr>`
        )
        .join("")}</table>`;
    case "allergy_alerts":
      return `<ul>${(p.allergies as any[])
        .map(
          (a) =>
            `<li><strong>${esc(a.substance)}</strong> — ${esc(a.reaction ?? "reaction not recorded")}${
              a.severity ? ` <em>(${esc(a.severity)})</em>` : ""
            }</li>`
        )
        .join("")}</ul>`;
    case "preventive_care":
      return `<ul>${(p.items as any[])
        .map(
          (i) =>
            `<li>${esc(i.item)} — <span class="muted">${esc(i.reason)}</span>${
              i.overdue ? ' <strong class="sev-high">due</strong>' : " ✓"
            }</li>`
        )
        .join("")}</ul>`;
    case "documents_digest": {
      const kinds = Object.entries(p.byKind as Record<string, number>)
        .map(([k, n]) => `${esc(k.replace(/_/g, " "))}: ${n}`)
        .join(", ");
      const review = (p.needsReview as any[])
        .map((d) => `<li>${esc(d.title)}</li>`)
        .join("");
      return (
        `<p>${p.total} documents on file (${kinds}).</p>` +
        (review ? `<p>Awaiting your review:</p><ul>${review}</ul>` : "<p>All extractions verified.</p>")
      );
    }
    case "lifestyle_notes":
      return `<ul>${(p.notes as any[])
        .map((n) => `<li>${esc(n.note)} <span class="muted">${esc(n.date ?? "")}</span></li>`)
        .join("")}</ul>`;
    default:
      return "";
  }
}

export function renderReportHtml(spec: ReportSpec): string {
  const sections = spec.sections
    .map(
      (s) => `
  <section>
    <h2>${esc(s.title)}</h2>
    <p class="rationale">Why you see this: ${esc(s.rationale)}</p>
    ${sectionBody(s)}
  </section>`
    )
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Vitalis Health Report — ${esc(spec.generatedAt.slice(0, 10))}</title>
<style>
  body { font-family: -apple-system, "Segoe UI", Roboto, sans-serif; max-width: 820px; margin: 2rem auto; padding: 0 1rem; color: #1a202c; }
  h1 { font-size: 1.5rem; } h2 { font-size: 1.15rem; border-bottom: 1px solid #e2e8f0; padding-bottom: .25rem; margin-top: 1.75rem; }
  h4 { margin: .75rem 0 .25rem; }
  table { border-collapse: collapse; width: 100%; margin: .5rem 0; font-size: .9rem; }
  th, td { text-align: left; padding: .3rem .6rem; border-bottom: 1px solid #edf2f7; }
  th { background: #f7fafc; }
  .rationale { font-size: .8rem; color: #718096; font-style: italic; margin-top: -.25rem; }
  .muted { color: #718096; }
  .sev-high, .sev-critical { color: #c53030; font-weight: 600; }
  .sev-low { color: #b7791f; }
  .disclaimer { margin-top: 2.5rem; padding: .75rem 1rem; background: #fffaf0; border: 1px solid #fbd38d; border-radius: .5rem; font-size: .85rem; }
  header .muted { font-size: .9rem; }
  @media print { body { margin: 0; } section { break-inside: avoid; } }
</style>
</head>
<body>
<header>
  <h1>Vitalis — Personal Health Report</h1>
  <p class="muted">Generated ${esc(spec.generatedAt)} · persona: ${esc(spec.persona.ageBand.replace(/_/g, " "))}${
    spec.persona.tags.length > 0 ? ` · focus: ${esc(spec.persona.tags.join(", "))}` : ""
  }</p>
</header>
${sections}
<p class="disclaimer"><strong>Disclaimer.</strong> ${esc(spec.disclaimer)}</p>
</body>
</html>`;
}
