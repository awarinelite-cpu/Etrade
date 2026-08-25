import { useState } from "react";
import { ALL_SYMBOLS } from "../lib/prices";
import { createAlert } from "../lib/api";

const initialState = {
  coin: "BTC",
  condition: "above",
  targetPrice: "",
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

  function validate() {
    const price = Number(form.targetPrice);
    if (!form.targetPrice || isNaN(price) || price <= 0) {
      return "Enter a target price greater than 0.";
    }
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
      await createAlert({
        chatId,
        coin: form.coin,
        condition: form.condition,
        targetPrice: Number(form.targetPrice),
        label: form.label || null,
        repeat: form.repeat,
      });
      setForm(initialState);
      onCreated?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

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
            onChange={(e) => update("condition", e.target.value)}
            className="bg-paper-raised border border-paper-border rounded-sm px-2 py-1.5 text-sm text-white"
          >
            <option value="above">above</option>
            <option value="below">below</option>
          </select>
        </label>
      </div>

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
        {submitting ? "Creating…" : "Create alert"}
      </button>
    </form>
  );
}
