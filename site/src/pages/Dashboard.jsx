import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import ChatIdGate from "../components/ChatIdGate";
import AlertCard from "../components/AlertCard";
import CreateAlertForm from "../components/CreateAlertForm";
import HistoryList from "../components/HistoryList";
import { useActiveAlerts, useAlertHistory } from "../hooks/useAlerts";
import { useLivePrices } from "../hooks/useLivePrices";

const STORAGE_KEY = "signal_dashboard_chat_id";

export default function Dashboard() {
  const [chatId, setChatId] = useState(() => localStorage.getItem(STORAGE_KEY) || "");
  const [tab, setTab] = useState("active");

  const { alerts, loading, error } = useActiveAlerts(chatId || null);
  const { history, error: historyError } = useAlertHistory(chatId || null);
  const displayError = error || historyError;
  const coins = alerts.map((a) => a.coin);
  const prices = useLivePrices(coins);

  useEffect(() => {
    if (chatId) localStorage.setItem(STORAGE_KEY, chatId);
  }, [chatId]);

  function handleChangeId() {
    localStorage.removeItem(STORAGE_KEY);
    setChatId("");
  }

  if (!chatId) {
    return (
      <div className="min-h-screen px-6">
        <TopNav />
        <ChatIdGate onSubmit={setChatId} error={error} />
      </div>
    );
  }

  return (
    <div className="min-h-screen px-6 pb-16">
      <TopNav />
      <div className="max-w-3xl mx-auto mt-8">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-buy opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-buy"></span>
            </span>
            <span className="text-xs font-mono text-fog">
              live · chat {chatId}
            </span>
          </div>
          <button
            onClick={handleChangeId}
            className="text-xs font-mono text-fog hover:text-white transition-colors"
          >
            Change ID
          </button>
        </div>

        <div className="flex gap-1 mb-6 border-b border-paper-border">
          {["active", "history"].map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-3 py-2 text-sm font-mono capitalize border-b-2 transition-colors ${
                tab === t
                  ? "border-buy text-white"
                  : "border-transparent text-fog hover:text-fog-bright"
              }`}
            >
              {t} {t === "active" ? `(${alerts.length})` : `(${history.length})`}
            </button>
          ))}
        </div>

        {displayError && (
          <div className="mb-6 rounded-md border border-sell bg-sell/10 px-3 py-2 text-xs font-mono text-sell">
            {displayError}
          </div>
        )}

        {tab === "active" ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <CreateAlertForm chatId={chatId} onCreated={() => {}} />
            {loading ? (
              <p className="text-fog text-sm">Loading alerts…</p>
            ) : (
              alerts.map((alert) => (
                <AlertCard
                  key={alert.id}
                  alert={alert}
                  chatId={chatId}
                  currentPrice={prices[alert.coin]}
                  onChanged={() => {}}
                />
              ))
            )}
            {!loading && alerts.length === 0 && (
              <p className="text-fog text-sm py-6 text-center border border-dashed border-paper-border rounded-md sm:col-span-2">
                No active alerts yet — create one on the left, or send{" "}
                <code className="font-mono text-amber">/alert</code> in Telegram.
              </p>
            )}
          </div>
        ) : (
          <HistoryList history={history} />
        )}
      </div>
    </div>
  );
}

function TopNav() {
  return (
    <header className="max-w-3xl mx-auto pt-6 flex items-center justify-between">
      <Link to="/" className="flex items-center gap-2 font-display font-semibold text-white">
        <span className="h-2 w-2 rounded-full bg-buy" />
        Signal
      </Link>
      <a
        href="https://t.me/E_TradingSignalAlertsBot"
        target="_blank"
        rel="noreferrer"
        className="text-xs font-mono text-fog hover:text-white transition-colors"
      >
        Open in Telegram
      </a>
    </header>
  );
}
