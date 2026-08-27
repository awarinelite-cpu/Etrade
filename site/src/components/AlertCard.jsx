import { useState } from "react";
import ProximityBar from "./ProximityBar";
import { updateAlert, deleteAlert } from "../lib/api";
import LivePrice from "./LivePrice";

const INDICATOR_INTERVALS = ["15m", "1h", "4h", "1d"];
const PRICE_CONDITIONS = ["above", "below"];
const RSI_CONDITIONS = ["rsi_below", "rsi_above"];
const MACD_CONDITIONS = ["macd_bullish_cross", "macd_bearish_cross"];

const CONDITION_GROUPS = [
  {
    label: "Price",
    options: [
      { value: "above", text: "above" },
      { value: "below", text: "below" },
    ],
  },
  {
    label: "RSI",
    options: [
      { value: "rsi_below", text: "RSI drops below" },
      { value: "rsi_above", text: "RSI rises above" },
    ],
  },
  {
    label: "MACD",
    options: [
      { value: "macd_bullish_cross", text: "MACD turns bullish" },
      { value: "macd_bearish_cross", text: "MACD turns bearish" },
    ],
  },
  {
    label: "Momentum",
    options: [{ value: "percent_move", text: "Price moves \u00b1X%" }],
  },
];

function formatPrice(n) {
  if (typeof n !== "number") return "\u2014";
  return `$${n.toLocaleString()}`;
}

// Builds the "Alert when ..." sentence for whichever condition type this
// alert is — mirrors the message text checkPrices builds server-side, kept
// separate since one runs in Firestore Functions and one in the browser.
function describeAlert(alert) {
  if (PRICE_CONDITIONS.includes(alert.condition)) {
    return (
      <>
        Alert when {alert.coin} goes{" "}
        <span className="text-white font-medium">{alert.condition}</span>{" "}
        <span className="font-mono text-white">{formatPrice(alert.targetPrice)}</span>
      </>
    );
  }
  if (RSI_CONDITIONS.includes(alert.condition)) {
    const direction = alert.condition === "rsi_below" ? "drops below" : "rises above";
    return (
      <>
        Alert when {alert.coin}'s RSI ({alert.indicatorInterval}){" "}
        <span className="text-white font-medium">{direction}</span>{" "}
        <span className="font-mono text-white">{alert.threshold}</span>
      </>
    );
  }
  if (MACD_CONDITIONS.includes(alert.condition)) {
    const direction = alert.condition === "macd_bullish_cross" ? "bullish" : "bearish";
    return (
      <>
        Alert when {alert.coin}'s MACD ({alert.indicatorInterval}) turns{" "}
        <span className="text-white font-medium">{direction}</span>
      </>
    );
  }
  if (alert.condition === "percent_move") {
    return (
      <>
        Alert when {alert.coin} moves{" "}
        <span className="font-mono text-white">\u00b1{alert.threshold}%</span> in{" "}
        <span className="text-white font-medium">{alert.windowMinutes} minutes</span>
      </>
    );
  }
  return `Alert on ${alert.coin}`;
}

export default function AlertCard({ alert, chatId, currentPrice, onChanged }) {
  const [editing, setEditing] = useState(false);
  const [condition, setCondition] = useState(alert.condition);
  const [targetPrice, setTargetPrice] = useState(alert.targetPrice != null ? String(alert.targetPrice) : "");
  const [threshold, setThreshold] = useState(alert.threshold != null ? String(alert.threshold) : "");
  const [indicatorInterval, setIndicatorInterval] = useState(alert.indicatorInterval || "1h");
  const [windowMinutes, setWindowMinutes] = useState(alert.windowMinutes != null ? String(alert.windowMinutes) : "60");
  const [repeat, setRepeat] = useState(Boolean(alert.repeat));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const isPriceAlert = PRICE_CONDITIONS.includes(alert.condition);
  const tone = alert.label === "SELL" ? "sell" : alert.label === "BUY" ? "buy" : alert.condition === "below" ? "sell" : "buy";

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const payload = { id: alert.id, chatId, condition, repeat };
      if (PRICE_CONDITIONS.includes(condition)) {
        payload.targetPrice = Number(targetPrice);
      } else if (RSI_CONDITIONS.includes(condition)) {
        payload.threshold = Number(threshold);
        payload.indicatorInterval = indicatorInterval;
      } else if (MACD_CONDITIONS.includes(condition)) {
        payload.indicatorInterval = indicatorInterval;
      } else if (condition === "percent_move") {
        payload.threshold = Number(threshold);
        payload.windowMinutes = Number(windowMinutes);
      }
      await updateAlert(payload);
      setEditing(false);
      onChanged?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    setSaving(true);
    try {
      await deleteAlert({ id: alert.id, chatId });
      onChanged?.();
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  const showInterval = RSI_CONDITIONS.includes(condition) || MACD_CONDITIONS.includes(condition);

  return (
    <div className="rounded-md border border-paper-border bg-paper p-4 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-mono font-semibold text-lg text-white">{alert.coin}</span>
          {alert.label && (
            <span
              className={`text-xs font-mono px-1.5 py-0.5 rounded-sm border ${
                alert.label === "BUY"
                  ? "text-buy border-buy-dim"
                  : "text-sell border-sell-dim"
              }`}
            >
              {alert.label}
            </span>
          )}
          {alert.repeat && (
            <span className="text-xs font-mono px-1.5 py-0.5 rounded-sm border border-amber text-amber">
              \ud83d\udd01 repeat
            </span>
          )}
        </div>
        <LivePrice price={currentPrice} />
      </div>

      {!editing ? (
        <>
          <p className="text-fog-bright text-sm">{describeAlert(alert)}</p>
          {isPriceAlert ? (
            <ProximityBar
              condition={alert.condition}
              targetPrice={alert.targetPrice}
              currentPrice={currentPrice}
              tone={tone}
            />
          ) : (
            <p className="text-xs text-fog-dim font-mono">
              Checked every minute against live {RSI_CONDITIONS.includes(alert.condition) || MACD_CONDITIONS.includes(alert.condition) ? alert.indicatorInterval : "1m"} data
            </p>
          )}
          <div className="flex gap-2 pt-1">
            <button
              onClick={() => setEditing(true)}
              className="text-xs font-mono px-2.5 py-1.5 rounded-sm border border-paper-border text-fog-bright hover:border-fog hover:text-white transition-colors"
            >
              Edit
            </button>
            <button
              onClick={handleDelete}
              disabled={saving}
              className="text-xs font-mono px-2.5 py-1.5 rounded-sm border border-paper-border text-fog-bright hover:border-sell hover:text-sell transition-colors disabled:opacity-50"
            >
              {saving ? "Deleting\u2026" : "Delete"}
            </button>
          </div>
        </>
      ) : (
        <form onSubmit={handleSave} className="flex flex-col gap-2">
          <select
            value={condition}
            onChange={(e) => setCondition(e.target.value)}
            className="bg-paper-raised border border-paper-border rounded-sm px-2 py-1.5 text-sm text-white"
          >
            {CONDITION_GROUPS.map((group) => (
              <optgroup key={group.label} label={group.label}>
                {group.options.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.text}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>

          {PRICE_CONDITIONS.includes(condition) && (
            <input
              type="number"
              step="any"
              value={targetPrice}
              onChange={(e) => setTargetPrice(e.target.value)}
              placeholder="Target price"
              className="bg-paper-raised border border-paper-border rounded-sm px-2 py-1.5 text-sm text-white font-mono"
            />
          )}

          {RSI_CONDITIONS.includes(condition) && (
            <input
              type="number"
              step="any"
              min="0"
              max="100"
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
              placeholder="RSI threshold (0\u2013100)"
              className="bg-paper-raised border border-paper-border rounded-sm px-2 py-1.5 text-sm text-white font-mono"
            />
          )}

          {condition === "percent_move" && (
            <div className="flex gap-2">
              <input
                type="number"
                step="any"
                value={threshold}
                onChange={(e) => setThreshold(e.target.value)}
                placeholder="% move"
                className="flex-1 bg-paper-raised border border-paper-border rounded-sm px-2 py-1.5 text-sm text-white font-mono"
              />
              <input
                type="number"
                step="1"
                min="5"
                max="1440"
                value={windowMinutes}
                onChange={(e) => setWindowMinutes(e.target.value)}
                placeholder="Window (min)"
                className="flex-1 bg-paper-raised border border-paper-border rounded-sm px-2 py-1.5 text-sm text-white font-mono"
              />
            </div>
          )}

          {showInterval && (
            <select
              value={indicatorInterval}
              onChange={(e) => setIndicatorInterval(e.target.value)}
              className="bg-paper-raised border border-paper-border rounded-sm px-2 py-1.5 text-sm text-white font-mono"
            >
              {INDICATOR_INTERVALS.map((iv) => (
                <option key={iv} value={iv}>
                  {iv}
                </option>
              ))}
            </select>
          )}

          <label className="flex items-center gap-2 text-xs text-fog-bright">
            <input
              type="checkbox"
              checked={repeat}
              onChange={(e) => setRepeat(e.target.checked)}
              className="accent-buy"
            />
            Repeat \u2014 fire every time the condition is met again
          </label>
          {error && <p className="text-sell text-xs">{error}</p>}
          <div className="flex gap-2 pt-1">
            <button
              type="submit"
              disabled={saving}
              className="text-xs font-mono px-2.5 py-1.5 rounded-sm bg-buy text-[#06210F] font-medium disabled:opacity-50"
            >
              {saving ? "Saving\u2026" : "Save changes"}
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="text-xs font-mono px-2.5 py-1.5 rounded-sm border border-paper-border text-fog-bright hover:text-white transition-colors"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
