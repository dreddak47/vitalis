"use client";
export default function PrintButton() {
  return <button onClick={() => window.print()} className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white">Print / Save as PDF</button>;
}
