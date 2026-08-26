const BUY = "#35D07F";
const SELL = "#FF5C5C";
const EMA_LINE = "#F5A623";

/**
 * Renders `candles` (oldest first) as an OHLC candlestick chart, with an
 * optional EMA line overlaid (pass `emaSeries`, same length/order as
 * candles, undefined entries are skipped). Fixed logical coordinate space
 * via viewBox, rendered width="100%" so it fills whatever container it's
 * placed in.
 */
export default function CandlestickChart({
  candles,
  emaSeries,
  width = 600,
  height = 260,
}) {
  if (!candles || candles.length < 2) {
    return (
      <div
        className="flex items-center justify-center text-fog-dim text-sm font-mono"
        style={{ height }}
      >
        No chart data available
      </div>
    );
  }

  const padTop = 10;
  const padBottom = 10;
  const usableHeight = height - padTop - padBottom;

  const low = Math.min(...candles.map((c) => c.low));
  const high = Math.max(...candles.map((c) => c.high));
  const range = high - low || 1;

  const step = width / candles.length;
  const bodyWidth = Math.max(step * 0.55, 1);

  function y(price) {
    return padTop + usableHeight - ((price - low) / range) * usableHeight;
  }

  const emaPoints = (emaSeries || [])
    .map((v, i) => (v !== undefined ? `${(i + 0.5) * step},${y(v)}` : null))
    .filter(Boolean)
    .join(" ");

  return (
    <svg
      width="100%"
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className="block"
    >
      {candles.map((c, i) => {
        const cx = (i + 0.5) * step;
        const up = c.close >= c.open;
        const color = up ? BUY : SELL;
        const bodyTop = y(Math.max(c.open, c.close));
        const bodyBottom = y(Math.min(c.open, c.close));
        const bodyHeight = Math.max(bodyBottom - bodyTop, 1);

        return (
          <g key={c.time}>
            <line
              x1={cx}
              x2={cx}
              y1={y(c.high)}
              y2={y(c.low)}
              stroke={color}
              strokeWidth="1"
            />
            <rect
              x={cx - bodyWidth / 2}
              y={bodyTop}
              width={bodyWidth}
              height={bodyHeight}
              fill={color}
            />
          </g>
        );
      })}

      {emaPoints && (
        <polyline
          points={emaPoints}
          fill="none"
          stroke={EMA_LINE}
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity="0.85"
        />
      )}
    </svg>
  );
}
