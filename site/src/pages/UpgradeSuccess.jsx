import { Link } from "react-router-dom";

export default function UpgradeSuccess() {
  return (
    <div className="min-h-screen px-6 flex items-center justify-center">
      <div className="max-w-sm text-center flex flex-col gap-4">
        <div className="text-4xl">✅</div>
        <h1 className="font-display text-2xl font-semibold text-white">
          Payment received
        </h1>
        <p className="text-fog-bright text-sm">
          Head back to Telegram — the bot will confirm your upgrade there in
          a few seconds.
        </p>
        <a
          href="https://t.me/E_TradingSignalAlertsBot"
          target="_blank"
          rel="noreferrer"
          className="mt-2 text-sm font-mono px-4 py-2 rounded-sm bg-buy text-[#06210F] font-medium"
        >
          Open in Telegram
        </a>
        <Link to="/dashboard" className="text-xs font-mono text-fog hover:text-white transition-colors">
          Or view your dashboard
        </Link>
      </div>
    </div>
  );
}
