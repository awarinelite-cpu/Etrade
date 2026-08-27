import { useState } from "react";
import { ALL_SYMBOLS } from "../lib/prices";
import { createAlert } from "../lib/api";

// Mirrors functions/alertsCore.js's INDICATOR_INTERVALS/DEFAULT_INDICATOR_INTERVAL
// and DEFAULT_WINDOW_MINUTES — kept in sync by hand since the form needs
// them before ever calling the API.
const INDICATOR_INTERVALS = ["15m", "1h", "4h", "1d"];
const DEFAULT_INDICATOR_INTERVAL = "1h";
const DEFAULT_WINDOW_MINUTES = 60;

const CONDITION_GROUPS = [
  {
    label: "Price",
    options: [
      { value: "above", text: "Price above" },
      { value: "below", text: "Price below" },
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
    options: [{ value: "percent_move", text: "Price moves \u00b1X% in a window" }],
  },
];

const PRICE_CONDITIONS = ["above", "below"];
const RSI_CONDITIONS = ["rsi_below", "rsi_above"];
const MACD_CONDITIONS = ["macd_bullish_cross", "macd_bearish_cross"];

const initialState = {
  coin: "BTC",
  condition: "above",
  targetPrice: "",
  threshold: "",
  indicatorInterval: DEFAULT_INDICATOR_INTERVAL,
  windowMinutes: String(DEFAULT_WINDOW_MINUTES),
  label: "",
  repeat: false,
};

export default function CreateAlertForm({ chatId, onCreated }) {
  const [form, setForm] = useState(initialState);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  // Switching condition category resets the fields the old category owned,
  // so e.g. leftover "70000" in targetPrice doesn't get silently reused as
  // an RSI threshold if the user flips from a price alert to an RSI one.
  function updateCondition(condition) {
    setForm((f) => ({ ...initialState, coin: f.coin, condition, label: f.label, repeat: f.repeat }));
  }

  function validate() {
    if (PRICE_CONDITIONS.includes(form.condition)) {
      const price = Number(form.targetPrice);
      if (!form.targetPrice || isNaN(price) || price <= 0) {
        return "Enter a target price greater than 0.";
      }
    } else if (RSI_CONDITIONS.includes(form.condition)) {
      const rsi = Number(form.threshold);
      if (form.threshold === "" || isNaN(rsi) || rsi < 0 || rsi > 100) {
        return "Enter an RSI threshold between 0 and 100.";
      }
    } else if (form.condition === "percent_move") {
      const pct = Number(form.threshold);
      if (!form.threshold || isNaN(pct) || pct <= 0) {
        return "Enter a percent move greater than 0.";
      }
      const window = Number(form.windowMinutes);
      if (!form.windowMinutes || isNaN(window) || window < 5 || window > 1440) {
        return "Window must be between 5 and 1440 minutes.";
      }
    }
    // MACD conditions need no extra field beyond the interval, which
    // always has a valid default.
    return null;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const payload = {
        chatId,
        coin: form.coin,
        condition: form.condition,
        label: form.label || null,
        repeat: form.repeat,
      };
      if (PRICE_CONDITIONS.includes(form.condition)) {
        payload.targetPrice = Number(form.targetPrice);
      } else if (RSI_CONDITIONS.includes(form.condition)) {
        payload.threshold = Number(form.threshold);
        payload.indicatorInterval = form.indicatorInterval;
      } else if (MACD_CONDITIONS.includes(form.condition)) {
        payload.indicatorInterval = form.indicatorInterval;
      } else if (form.condition === "percent_move") {
        payload.threshold = Number(form.threshold);
        payload.windowMinutes = Number(form.windowMinutes);
      }
      await createAlert(payload);
      setForm(initialState);
      onCreated?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  const showTargetPrice = PRICE_CONDITIONS.includes(form.condition);
  const showThresholdRsi = RSI_CONDITIONS.includes(form.condition);
  const showThresholdPercent = form.condition === "percent_move";
  const showInterval = RSI_CONDITIONS.includes(form.condition) || MACD_CONDITIONS.includes(form.condition);

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-md border border-paper-border bg-paper p-4 flex flex-col gap-3"
    >
      <h3 className="font-display font-semibold text-white text-sm tracking-wide">
        New alert
      </h3>

      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1 text-xs text-fog-bright">
          Asset
          <select
            value={form.coin}
            onChange={(e) => update("coin", e.target.value)}
            className="bg-paper-raised border border-paper-border rounded-sm px-2 py-1.5 text-sm text-white font-mono"
          >
            {ALL_SYMBOLS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs text-fog-bright">
          Condition
          <select
            value={form.condition}
            onChange={(e) => updateCondition(e.target.value)}
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
        </label>
      </div>

      {showTargetPrice && (
        <label className="flex flex-col gap-1 text-xs text-fog-bright">
          Target price (USD)
          <input
            type="number"
            step="any"
            placeholder="e.g. 70000"
            value={form.targetPrice}
            onChange={(e) => update("targetPrice", e.target.value)}
            className="bg-paper-raised border border-paper-border rounded-sm px-2 py-1.5 text-sm text-white font-mono placeholder:text-fog-dim"
          />
        </label>
      )}

      {showThresholdRsi && (
        <label className="flex flex-col gap-1 text-xs text-fog-bright">
          RSI threshold (0\u2013100)
          <input
            type="number"
            step="any"
            min="0"
            max="100"
            placeholder="e.g. 30"
            value={form.threshold}
            onChange={(e) => update("threshold", e.target.value)}
            className="bg-paper-raised border border-paper-border rounded-sm px-2 py-1.5 text-sm text-white font-mono placeholder:text-fog-dim"
          />
        </label>
      )}

      {showThresholdPercent && (
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1 text-xs text-fog-bright">
            Move (%)
            <input
              type="number"
              step="any"
              placeholder="e.g. 5"
              value={form.threshold}
              onChange={(e) => update("threshold", e.target.value)}
              className="bg-paper-raised border border-paper-border rounded-sm px-2 py-1.5 text-sm text-white font-mono placeholder:text-fog-dim"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-fog-bright">
            Window (minutes)
            <input
              type="number"
              step="1"
              min="5"
              max="1440"
              placeholder="e.g. 60"
              value={form.windowMinutes}
              onChange={(e) => update("windowMinutes", e.target.value)}
              className="bg-paper-raised border border-paper-border rounded-sm px-2 py-1.5 text-sm text-white font-mono placeholder:text-fog-dim"
            />
          </label>
        </div>
      )}

      {showInterval && (
        <label className="flex flex-col gap-1 text-xs text-fog-bright">
          Timeframe
          <select
            value={form.indicatorInterval}
            onChange={(e) => update("indicatorInterval", e.target.value)}
            className="bg-paper-raised border border-paper-border rounded-sm px-2 py-1.5 text-sm text-white font-mono"
          >
            {INDICATOR_INTERVALS.map((iv) => (
              <option key={iv} value={iv}>
                {iv}
              </option>
            ))}
          </select>
        </label>
      )}

      <div className="grid grid-cols-2 gap-2 items-end">
        <label className="flex flex-col gap-1 text-xs text-fog-bright">
          Label (optional)
          <select
            value={form.label}
            onChange={(e) => update("label", e.target.value)}
            className="bg-paper-raised border border-paper-border rounded-sm px-2 py-1.5 text-sm text-white"
          >
            <option value="">None</option>
            <option value="BUY">BUY</option>
            <option value="SELL">SELL</option>
          </select>
        </label>

        <label className="flex items-center gap-2 text-xs text-fog-bright pb-2">
          <input
            type="checkbox"
            checked={form.repeat}
            onChange={(e) => update("repeat", e.target.checked)}
            className="accent-buy"
          />
          Repeat
        </label>
      </div>

      {error && <p className="text-sell text-xs">{error}</p>}

      <button
        type="submit"
        disabled={submitting}
        className="mt-1 text-sm font-mono px-3 py-2 rounded-sm bg-buy text-[#06210F] font-medium disabled:opacity-50"
      >
        {submitting ? "Creating\u2026" : "Create alert"}
      </button>
    </form>
  );
}
