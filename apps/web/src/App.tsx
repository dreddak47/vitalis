import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import { DocumentsPage } from "./pages/DocumentsPage";
import { MedicationsPage } from "./pages/MedicationsPage";
import { ReportPage } from "./pages/ReportPage";
import { SettingsPage } from "./pages/SettingsPage";

export function App() {
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">✚</span> Vitalis
        </div>
        <nav>
          <NavLink to="/report" className={({ isActive }) => (isActive ? "active" : "")}>
            Health Report
          </NavLink>
          <NavLink to="/medications" className={({ isActive }) => (isActive ? "active" : "")}>
            Medications
          </NavLink>
          <NavLink to="/documents" className={({ isActive }) => (isActive ? "active" : "")}>
            Documents
          </NavLink>
          <NavLink to="/settings" className={({ isActive }) => (isActive ? "active" : "")}>
            Settings &amp; Privacy
          </NavLink>
        </nav>
        <p className="sidebar-note">
          Privacy-first: your records stay in your store. Extraction runs are audited.
        </p>
      </aside>
      <main className="content">
        <Routes>
          <Route path="/" element={<Navigate to="/report" replace />} />
          <Route path="/report" element={<ReportPage />} />
          <Route path="/medications" element={<MedicationsPage />} />
          <Route path="/documents" element={<DocumentsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </main>
    </div>
  );
}
