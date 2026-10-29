import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { Geist } from "next/font/google";
import "./globals.css";
import { currentProfile } from "@/lib/session";
import ProfileSwitcher from "@/components/ProfileSwitcher";

const geist = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Vitalis — your health records, arranged for you",
  description: "Upload lab reports and prescriptions. Vitalis reads them with MedGemma and builds a dashboard around your health.",
  manifest: "/manifest.webmanifest",
};
export const viewport: Viewport = { themeColor: "#0f766e", width: "device-width", initialScale: 1 };

const NAV = [
  { href: "/", label: "Home", icon: "⌂" },
  { href: "/upload", label: "Upload", icon: "＋" },
  { href: "/ask", label: "Ask", icon: "?" },
  { href: "/visit", label: "Visit", icon: "☰" },
  { href: "/profiles", label: "Family", icon: "◎" },
];

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const { all, profile } = await currentProfile();
  return (
    <html lang="en" className={`${geist.variable} h-full antialiased`} style={profile?.view_pref === "simple" ? { fontSize: "112.5%" } : undefined}>
      <body className="min-h-full bg-slate-50 font-sans text-slate-800">
        <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/90 backdrop-blur">
          <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-2.5">
            <Link href="/" className="flex items-center gap-2 font-semibold text-teal-800">
              <span className="grid h-7 w-7 place-items-center rounded-lg bg-teal-700 text-white" aria-hidden>V</span>
              <span className="hidden sm:inline">Vitalis</span>
            </Link>
            <nav className="hidden gap-1 md:flex" aria-label="Main">
              {NAV.map((n) => <Link key={n.href} href={n.href} className="rounded-lg px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100">{n.label}</Link>)}
              <Link href="/plans" className="rounded-lg px-3 py-1.5 text-sm font-medium text-teal-700 hover:bg-teal-50">Plans</Link>
            </nav>
            {profile && <ProfileSwitcher profiles={all.map((p) => ({ id: p.id, name: p.name }))} current={profile.id} />}
          </div>
        </header>
        <main className="mx-auto max-w-5xl px-4 pb-28 pt-4 md:pb-10">{children}</main>
        <footer className="mx-auto max-w-5xl px-4 pb-24 text-xs text-slate-500 md:pb-6">
          Not a diagnosis. Values are compared to the lab&apos;s (or a typical adult) reference range. Always discuss results with your doctor.
        </footer>
        <nav className="fixed inset-x-0 bottom-0 z-10 grid grid-cols-5 border-t border-slate-200 bg-white md:hidden" aria-label="Main mobile">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className="flex flex-col items-center py-2 text-xs text-slate-600">
              <span className="text-lg leading-none" aria-hidden>{n.icon}</span>{n.label}
            </Link>
          ))}
        </nav>
      </body>
    </html>
  );
}
