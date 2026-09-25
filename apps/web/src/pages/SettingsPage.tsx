import { useCallback, useEffect, useState } from "react";
import type { DisplayPreferences, RetentionPolicy, UserProfile } from "@vitalis/shared";
import { api } from "../api";

const FOCUS_OPTIONS = [
  ["heart_health", "Heart health"],
  ["metabolic", "Metabolic (diabetes, lipids, thyroid)"],
  ["medications", "Medications"],
  ["vitals", "Vitals"],
  ["mental_health", "Mental health"],
  ["preventive_care", "Preventive care"],
  ["allergies", "Allergies"],
] as const;

export function SettingsPage() {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [prefs, setPrefs] = useState<DisplayPreferences | null>(null);
  const [retention, setRetention] = useState<RetentionPolicy | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [p, pr, r] = await Promise.all([
      api.getProfile(),
      api.getPreferences(),
      api.getRetention(),
    ]);
    setProfile(p);
    setPrefs(pr);
    setRetention(r);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const flash = (what: string) => {
    setSaved(what);
    setTimeout(() => setSaved(null), 2000);
  };

  if (error) return <div className="error-box">{error}</div>;
  if (!profile || !prefs || !retention) return <p className="meta">Loading…</p>;

  return (
    <>
      <div className="page-head"><h1>Settings &amp; Privacy</h1></div>

      <div className="card">
        <h2>Profile</h2>
        <p className="legend">Age and sex drive which report sections and screenings you see.</p>
        <div className="form-grid">
          <label>Name
            <input value={profile.displayName} onChange={(e) => setProfile({ ...profile, displayName: e.target.value })} />
          </label>
          <label>Date of birth
            <input type="date" value={profile.dob ?? ""} onChange={(e) => setProfile({ ...profile, dob: e.target.value || null })} />
          </label>
          <label>Sex
            <select value={profile.sex ?? ""} onChange={(e) => setProfile({ ...profile, sex: (e.target.value || null) as UserProfile["sex"] })}>
              <option value="">—</option>
              <option value="female">female</option>
              <option value="male">male</option>
              <option value="intersex">intersex</option>
              <option value="unknown">prefer not to say</option>
            </select>
          </label>
        </div>
        <button className="primary" onClick={async () => { await api.saveProfile(profile); flash("profile"); }}>Save profile</button>
      </div>

      <div className="card">
        <h2>Report preferences</h2>
        <p className="legend">This is what makes your report <em>yours</em> — the compiler reads these live on every generation.</p>
        <div className="form-grid">
          <label>Detail level
            <select value={prefs.detailLevel} onChange={(e) => setPrefs({ ...prefs, detailLevel: e.target.value as DisplayPreferences["detailLevel"] })}>
              <option value="at_a_glance">At a glance</option>
              <option value="standard">Standard</option>
              <option value="deep_dive">Deep dive</option>
            </select>
          </label>
          <label>Language
            <select value={prefs.language} onChange={(e) => setPrefs({ ...prefs, language: e.target.value as DisplayPreferences["language"] })}>
              <option value="plain">Plain language</option>
              <option value="clinical">Clinical terminology</option>
            </select>
          </label>
        </div>
        <fieldset style={{ border: "none", padding: 0, margin: "0 0 0.75rem" }}>
          <legend className="legend" style={{ marginBottom: "0.4rem" }}>Focus areas (pinned to the top of your report)</legend>
          {FOCUS_OPTIONS.map(([value, label]) => (
            <label key={value} className="checkbox-row">
              <input
                type="checkbox"
                checked={prefs.focusAreas.includes(value)}
                onChange={(e) =>
                  setPrefs({
                    ...prefs,
                    focusAreas: e.target.checked
                      ? [...prefs.focusAreas, value]
                      : prefs.focusAreas.filter((f) => f !== value),
                  })
                }
              />
              {label}
            </label>
          ))}
        </fieldset>
        <label className="checkbox-row">
          <input type="checkbox" checked={prefs.showTrends} onChange={(e) => setPrefs({ ...prefs, showTrends: e.target.checked })} />
          Show trend charts
        </label>
        <label className="checkbox-row">
          <input type="checkbox" checked={prefs.showReferenceRanges} onChange={(e) => setPrefs({ ...prefs, showReferenceRanges: e.target.checked })} />
          Show reference ranges
        </label>
        <div style={{ marginTop: "0.75rem" }}>
          <button className="primary" onClick={async () => { setPrefs(await api.savePreferences(prefs)); flash("preferences"); }}>Save preferences</button>
        </div>
      </div>

      <div className="card">
        <h2>Data retention</h2>
        <p className="legend">Your controls, enforced by the server and recorded in the audit log.</p>
        <div className="form-grid">
          <label>Keep raw files for (days, empty = forever)
            <input
              type="number"
              value={retention.rawFileRetentionDays ?? ""}
              onChange={(e) =>
                setRetention({ ...retention, rawFileRetentionDays: e.target.value ? Number(e.target.value) : null })
              }
            />
          </label>
        </div>
        <label className="checkbox-row">
          <input type="checkbox" checked={retention.factsExpireWithDocument} onChange={(e) => setRetention({ ...retention, factsExpireWithDocument: e.target.checked })} />
          Delete extracted facts when their source document is deleted
        </label>
        <label className="checkbox-row">
          <input type="checkbox" checked={retention.allowTrainingUse} onChange={(e) => setRetention({ ...retention, allowTrainingUse: e.target.checked })} />
          Allow my de-identified data to improve extraction models (default off — opt-in only)
        </label>
        <div style={{ marginTop: "0.75rem" }}>
          <button className="primary" onClick={async () => { setRetention(await api.saveRetention(retention)); flash("retention"); }}>Save retention policy</button>
        </div>
      </div>

      <div className="card">
        <h2>Your data, your call</h2>
        <div className="btn-row">
          <a href={api.exportUrl()}><button>⬇ Export everything (JSON)</button></a>
          <button
            className="danger"
            onClick={async () => {
              if (confirm("Delete ALL your documents, records and settings? This cannot be undone.")) {
                await api.deleteEverything();
                window.location.reload();
              }
            }}
          >
            Delete everything
          </button>
        </div>
      </div>

      {saved && <p className="pill normal">saved {saved}</p>}
    </>
  );
}
