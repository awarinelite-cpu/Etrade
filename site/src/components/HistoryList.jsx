function formatPrice(n) {
  if (typeof n !== "number") return "—";
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
            <span className="text-fog-bright">
              {h.condition} {formatPrice(h.targetPrice)}
            </span>
            <span className="text-fog"> → triggered at {formatPrice(h.triggeredAtPrice)}</span>
          </div>
          <span className="text-fog-dim text-xs font-mono">{formatTimestamp(h.triggeredAt)}</span>
        </div>
      ))}
    </div>
  );
}
