interface Point {
  date: string | null;
  value: number | null;
}

interface Props {
  points: Point[];
  referenceLow?: number | null;
  referenceHigh?: number | null;
  width?: number;
  height?: number;
}

/** Minimal dependency-free SVG trend line, with reference band. */
export function Sparkline({ points, referenceLow, referenceHigh, width = 560, height = 110 }: Props) {
  const valid = points.filter((p) => p.value !== null) as Array<{ date: string | null; value: number }>;
  if (valid.length === 0) return null;

  const values = valid.map((p) => p.value);
  const min = Math.min(...values, referenceLow ?? Infinity) * 0.95;
  const max = Math.max(...values, referenceHigh ?? -Infinity) * 1.05;
  const span = max - min || 1;

  const x = (i: number) => (valid.length === 1 ? width / 2 : (i / (valid.length - 1)) * (width - 20) + 10);
  const y = (v: number) => height - 12 - ((v - min) / span) * (height - 24);

  const path = valid.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");

  return (
    <svg className="spark" viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="img">
      {referenceLow !== null && referenceLow !== undefined && referenceHigh !== null && referenceHigh !== undefined && (
        <rect
          x={0}
          y={y(referenceHigh)}
          width={width}
          height={Math.max(0, y(referenceLow) - y(referenceHigh))}
          fill="#f0fff4"
        />
      )}
      <path d={path} fill="none" stroke="#0e7490" strokeWidth={2} />
      {valid.map((p, i) => (
        <g key={i}>
          <circle cx={x(i)} cy={y(p.value)} r={3.5} fill="#0e7490" />
          <text x={x(i)} y={height - 1} fontSize={9} textAnchor="middle" fill="#718096">
            {(p.date ?? "").slice(5)}
          </text>
          <text x={x(i)} y={y(p.value) - 7} fontSize={9} textAnchor="middle" fill="#1a202c">
            {p.value}
          </text>
        </g>
      ))}
      {referenceHigh !== null && referenceHigh !== undefined && (
        <text x={4} y={y(referenceHigh) - 3} fontSize={9} fill="#2f855a">high ref {referenceHigh}</text>
      )}
    </svg>
  );
}
