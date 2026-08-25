// The signature element of the dashboard: a live "distance to target" bar.
// For an "above" alert, it fills as price rises toward the ceiling target.
// For a "below" alert, it fills as price falls toward the floor target.
// It's a rough heuristic (no fixed natural range to measure against), but
// it gives an at-a-glance read on urgency that a plain number doesn't.
export default function ProximityBar({ condition, targetPrice, currentPrice, tone }) {
  if (currentPrice === undefined) {
    return (
      <div className="h-1.5 w-full rounded-full bg-paper-border overflow-hidden">
        <div className="h-full w-1/12 bg-fog-dim animate-pulse" />
      </div>
    );
  }

  let percent;
  if (condition === "above") {
    percent = Math.min(100, (currentPrice / targetPrice) * 100);
  } else {
    percent = Math.min(100, (targetPrice / currentPrice) * 100);
  }
  percent = Math.max(2, percent);

  const hit =
    (condition === "above" && currentPrice >= targetPrice) ||
    (condition === "below" && currentPrice <= targetPrice);

  const fillColor = hit
    ? tone === "sell"
      ? "bg-sell"
      : "bg-buy"
    : tone === "sell"
    ? "bg-sell-dim"
    : "bg-buy-dim";

  return (
    <div
      className="h-1.5 w-full rounded-full bg-paper-border overflow-hidden"
      role="progressbar"
      aria-valuenow={Math.round(percent)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label="Distance to target price"
    >
      <div
        className={`h-full rounded-full transition-all duration-700 ease-out ${fillColor}`}
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}
