"use client";
import { LineChart, Line, XAxis, YAxis, Tooltip, ReferenceArea, ReferenceLine, ResponsiveContainer, CartesianGrid } from "recharts";
import type { TrendData } from "@/lib/trend";

const ts = (d: string) => Date.parse(d);
const fmtDate = (t: number) => new Date(t).toLocaleDateString(undefined, { month: "short", year: "2-digit" });

export default function TrendChart({ data, height = 220, compact = false }: { data: TrendData; height?: number; compact?: boolean }) {
  const points = data.points.map((p) => ({ x: ts(p.t), v: p.v }));
  const vals = points.map((p) => p.v).concat([data.low, data.high].filter((x): x is number => x != null));
  const pad = (Math.max(...vals) - Math.min(...vals)) * 0.15 || 1;
  const yMin = Math.max(0, Math.floor(Math.min(...vals) - pad)), yMax = Math.ceil(Math.max(...vals) + pad);
  const xMin = points[0]?.x ?? 0, xMax = points.at(-1)?.x ?? 0;
  const label = `${data.name} trend chart, ${data.points.length} results from ${data.points[0]?.t} to ${data.points.at(-1)?.t}`;

  return (
    <div role="img" aria-label={label} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={points} margin={{ top: 8, right: 12, bottom: 0, left: compact ? -20 : 0 }}>
          {!compact && <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />}
          <XAxis dataKey="x" type="number" scale="time" domain={[xMin, xMax]} tickFormatter={fmtDate} tick={{ fontSize: 11, fill: "#6b7280" }} minTickGap={40} />
          <YAxis domain={[yMin, yMax]} tick={{ fontSize: 11, fill: "#6b7280" }} width={44} />
          {(data.low != null || data.high != null) && (
            <ReferenceArea y1={data.low ?? yMin} y2={data.high ?? yMax} fill="#10b981" fillOpacity={0.08} ifOverflow="hidden" />
          )}
          {data.meds.filter((m) => ts(m.start) >= xMin && ts(m.start) <= xMax).map((m) => (
            <ReferenceLine key={m.name + m.start} x={ts(m.start)} stroke="#6366f1" strokeDasharray="4 3" label={compact ? undefined : { value: `▶ ${m.name}`, position: "insideTopLeft", fontSize: 11, fill: "#4f46e5" }} />
          ))}
          {data.meds.filter((m) => m.end && ts(m.end) >= xMin && ts(m.end) <= xMax).map((m) => (
            <ReferenceLine key={m.name + m.end} x={ts(m.end!)} stroke="#f43f5e" strokeDasharray="4 3" label={compact ? undefined : { value: `■ ${m.name}`, position: "insideBottomLeft", fontSize: 11, fill: "#e11d48" }} />
          ))}
          <Tooltip labelFormatter={(t) => new Date(Number(t)).toLocaleDateString()} formatter={(v) => [`${v} ${data.unit}`, data.name]} />
          <Line type="monotone" dataKey="v" stroke="#0f766e" strokeWidth={2} dot={{ r: compact ? 2 : 3 }} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
