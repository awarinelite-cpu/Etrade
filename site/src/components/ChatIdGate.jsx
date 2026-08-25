import { useState } from "react";

export default function ChatIdGate({ onSubmit, error }) {
  const [value, setValue] = useState("");

  const [localError, setLocalError] = useState("");

  function handleSubmit(e) {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) return;
    if (!/^-?\d+$/.test(trimmed)) {
      setLocalError(
        "That doesn't look like a chat ID — it should be numbers only (e.g. 123456789), from /myid in Telegram."
      );
      return;
    }
    setLocalError("");
    onSubmit(trimmed);
  }

  return (
    <div className="max-w-sm mx-auto mt-24 flex flex-col gap-4 text-center">
      <h1 className="font-display text-2xl font-semibold text-white">
        View your alerts
      </h1>
      <p className="text-fog-bright text-sm">
        Send <code className="font-mono text-amber">/myid</code> to the bot in
        Telegram, then paste your chat ID below.
      </p>
      <form onSubmit={handleSubmit} className="flex flex-col gap-2">
        <input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="e.g. 123456789"
          className="bg-paper-raised border border-paper-border rounded-sm px-3 py-2 text-sm text-white font-mono text-center placeholder:text-fog-dim"
        />
        <button
          type="submit"
          className="text-sm font-mono px-3 py-2 rounded-sm bg-buy text-[#06210F] font-medium"
        >
          View alerts
        </button>
      </form>
      {(localError || error) && (
        <p className="text-sell text-xs">{localError || error}</p>
      )}
    </div>
  );
}
