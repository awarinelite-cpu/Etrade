const RSI_CONDITIONS = ["rsi_below", "rsi_above"];
const MACD_CONDITIONS = ["macd_bullish_cross", "macd_bearish_cross"];

function formatPrice(n) {
  if (typeof n !== "number") return "\u2014";
  return `$${n.toLocaleString()}`;
}

function formatTimestamp(ts) {
  if (!ts?.toDate) return "";
  return ts.toDate().toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// Describes what fired and what the reading was at the moment it did \u2014
// mirrors the per-condition message text checkPrices builds server-side,
// since alert_history only stores the raw fields, not the sentence.
function describeHistoryEntry(h) {
  if (h.condition === "above" || h.condition === "below") {
    return (
      <>
        {h.condition} {formatPrice(h.targetPrice)}
        <span className="text-fog"> \u2192 triggered at {formatPrice(h.triggeredAtValue)}</span>
      </>
    );
  }
  if (RSI_CONDITIONS.includes(h.condition)) {
    const direction = h.condition === "rsi_below" ? "drops below" : "rises above";
    return (
      <>
        RSI ({h.indicatorInterval}) {direction} {h.threshold}
        <span className="text-fog"> \u2192 triggered at RSI {typeof h.triggeredAtValue === "number" ? h.triggeredAtValue.toFixed(1) : "\u2014"}</span>
      </>
    );
  }
  if (MACD_CONDITIONS.includes(h.condition)) {
    const direction = h.condition === "macd_bullish_cross" ? "bullish" : "bearish";
    return <>MACD ({h.indicatorInterval}) turned {direction}</>;
  }
  if (h.condition === "percent_move") {
    return (
      <>
        moved \u00b1{h.threshold}% in {h.windowMinutes}m
        <span className="text-fog">
          {" "}
          \u2192 triggered at {typeof h.triggeredAtValue === "number" ? `${h.triggeredAtValue >= 0 ? "+" : ""}${h.triggeredAtValue.toFixed(2)}%` : "\u2014"}
        </span>
      </>
    );
  }
  return h.condition;
}

export default function HistoryList({ history }) {
  if (history.length === 0) {
    return (
      <p className="text-fog text-sm py-6 text-center border border-dashed border-paper-border rounded-md">
        Nothing has triggered yet.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {history.map((h) => (
        <div
          key={h.id}
          className="rounded-sm border border-paper-border bg-paper px-3 py-2 flex items-center justify-between text-sm"
        >
          <div>
            <span className="font-mono font-medium text-white">{h.coin}</span>{" "}
            <span className="text-fog-bright">{describeHistoryEntry(h)}</span>
          </div>
          <span className="text-fog-dim text-xs font-mono">{formatTimestamp(h.triggeredAt)}</span>
        </div>
      ))}
    </div>
  );
}
