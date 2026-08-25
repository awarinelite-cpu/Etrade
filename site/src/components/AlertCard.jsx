import { useState } from "react";
import ProximityBar from "./ProximityBar";
import { updateAlert, deleteAlert } from "../lib/api";

function formatPrice(n) {
  if (typeof n !== "number") return "—";
  return `$${n.toLocaleString()}`;
}

export default function AlertCard({ alert, chatId, currentPrice, onChanged }) {
  const [editing, setEditing] = useState(false);
  const [condition, setCondition] = useState(alert.condition);
  const [targetPrice, setTargetPrice] = useState(String(alert.targetPrice));
  const [repeat, setRepeat] = useState(Boolean(alert.repeat));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const tone = alert.label === "SELL" ? "sell" : alert.label === "BUY" ? "buy" : alert.condition === "below" ? "sell" : "buy";

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await updateAlert({
        id: alert.id,
        chatId,
        condition,
        targetPrice: Number(targetPrice),
        repeat,
      });
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
              🔁 repeat
            </span>
          )}
        </div>
        <span className="font-mono text-sm text-fog font-tabular">
          {formatPrice(currentPrice)}
        </span>
      </div>

      {!editing ? (
        <>
          <p className="text-fog-bright text-sm">
            Alert when {alert.coin} goes{" "}
            <span className="text-white font-medium">{alert.condition}</span>{" "}
            <span className="font-mono text-white">{formatPrice(alert.targetPrice)}</span>
          </p>
          <ProximityBar
            condition={alert.condition}
            targetPrice={alert.targetPrice}
            currentPrice={currentPrice}
            tone={tone}
          />
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
              {saving ? "Deleting…" : "Delete"}
            </button>
          </div>
        </>
      ) : (
        <form onSubmit={handleSave} className="flex flex-col gap-2">
          <div className="flex gap-2">
            <select
              value={condition}
              onChange={(e) => setCondition(e.target.value)}
              className="flex-1 bg-paper-raised border border-paper-border rounded-sm px-2 py-1.5 text-sm text-white"
            >
              <option value="above">above</option>
              <option value="below">below</option>
            </select>
            <input
              type="number"
              step="any"
              value={targetPrice}
              onChange={(e) => setTargetPrice(e.target.value)}
              className="flex-1 bg-paper-raised border border-paper-border rounded-sm px-2 py-1.5 text-sm text-white font-mono"
            />
          </div>
          <label className="flex items-center gap-2 text-xs text-fog-bright">
            <input
              type="checkbox"
              checked={repeat}
              onChange={(e) => setRepeat(e.target.checked)}
              className="accent-buy"
            />
            Repeat — fire every time price re-crosses this target
          </label>
          {error && <p className="text-sell text-xs">{error}</p>}
          <div className="flex gap-2 pt-1">
            <button
              type="submit"
              disabled={saving}
              className="text-xs font-mono px-2.5 py-1.5 rounded-sm bg-buy text-[#06210F] font-medium disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save changes"}
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
