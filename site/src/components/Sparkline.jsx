// Colors mirror tailwind.config.js's buy/sell — hardcoded here since SVG
// stroke can't consume Tailwind classes directly.
const BUY = "#35D07F";
const SELL = "#FF5C5C";

/**
 * Renders `data` (an array of prices, oldest first) as a smooth-ish
 * sparkline. Colored by overall trend (last point vs first point).
 * Draws nothing until there are at least 2 points to connect.
 */
export default function Sparkline({ data, width = 120, height = 40 }) {
  if (!data || data.length < 2) {
    return <svg width={width} height={height} className="block" />;
  }

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  // Pad vertically so a flat-ish line doesn't hug the top/bottom edge.
  const pad = height * 0.15;
  const usableHeight = height - pad * 2;
  const stepX = width / (data.length - 1);

  const points = data
    .map((v, i) => {
      const x = i * stepX;
      const y = pad + usableHeight - ((v - min) / range) * usableHeight;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");

  const trendUp = data[data.length - 1] >= data[0];
  const stroke = trendUp ? BUY : SELL;
  const fillId = `spark-fill-${trendUp ? "up" : "down"}`;
  const lastPoint = points.split(" ").pop().split(",");

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className="block overflow-visible"
    >
      <defs>
        <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.25" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polyline
        points={`0,${height} ${points} ${width},${height}`}
        fill={`url(#${fillId})`}
        stroke="none"
      />
      <polyline
        points={points}
        fill="none"
        stroke={stroke}
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={lastPoint[0]} cy={lastPoint[1]} r="2.5" fill={stroke} />
    </svg>
  );
}
