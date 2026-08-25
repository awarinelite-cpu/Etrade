import { Link } from "react-router-dom";
import { SYMBOL_TO_ID, METAL_SYMBOL_TO_ID } from "../lib/prices";

export default function Landing() {
  return (
    <div className="min-h-screen">
      <header className="max-w-5xl mx-auto px-6 pt-6 flex items-center justify-between">
        <div className="flex items-center gap-2 font-display font-semibold text-white">
          <span className="h-2 w-2 rounded-full bg-buy" />
          E-Trading
        </div>
        <nav className="flex items-center gap-6">
          <Link to="/dashboard" className="text-sm text-fog-bright hover:text-white transition-colors">
            Dashboard
          </Link>
          <a
            href="https://t.me/E_TradingSignalAlertsBot"
            target="_blank"
            rel="noreferrer"
            className="text-sm font-mono px-3 py-1.5 rounded-sm bg-buy text-[#06210F] font-medium"
          >
            Open in Telegram
          </a>
        </nav>
      </header>

      <main className="max-w-3xl mx-auto px-6 pt-24 pb-32 text-center">
        <p className="font-mono text-xs text-amber tracking-widest uppercase mb-4">
          Telegram bot · alerts only · no trading
        </p>
        <h1 className="font-display text-4xl sm:text-5xl font-semibold text-white leading-tight">
          You set the price.
          <br />
          We watch the chart.
        </h1>
        <p className="text-fog-bright mt-6 max-w-lg mx-auto">
          Set a price target on any supported coin or metal. Get a Telegram
          message the second it's hit. No funds touched, no charts to babysit.
        </p>
        <a
          href="https://t.me/E_TradingSignalAlertsBot"
          target="_blank"
          rel="noreferrer"
          className="inline-block mt-8 text-sm font-mono px-5 py-3 rounded-sm bg-buy text-[#06210F] font-medium"
        >
          Start in Telegram →
        </a>

        <div className="mt-20 text-left grid sm:grid-cols-3 gap-6">
          <Feature
            title="Set it in one line"
            body={<code className="font-mono text-xs text-amber">/alert BTC above 70000</code>}
          />
          <Feature
            title="Repeats if you want"
            body="Add REPEAT and it fires every time price re-crosses your target, not just once."
          />
          <Feature
            title="Manage it here too"
            body="This dashboard mirrors the bot in real time — create, edit, or delete alerts from either place."
          />
        </div>

        <div id="coins" className="mt-20 text-left">
          <p className="font-mono text-xs text-fog uppercase tracking-widest mb-3">
            Supported assets
          </p>
          <div className="flex flex-wrap gap-2">
            {[...Object.keys(SYMBOL_TO_ID), ...Object.keys(METAL_SYMBOL_TO_ID)].map((s) => (
              <span
                key={s}
                className="font-mono text-xs px-2 py-1 rounded-sm border border-paper-border text-fog-bright"
              >
                {s}
              </span>
            ))}
          </div>
        </div>
      </main>

      <footer className="max-w-5xl mx-auto px-6 pb-10 text-center">
        <p className="font-mono text-xs text-fog-dim">
          Elite Trading Alert System · All rights reserved © 2026
        </p>
      </footer>
    </div>
  );
}

function Feature({ title, body }) {
  return (
    <div className="rounded-md border border-paper-border bg-paper p-4">
      <h3 className="font-display text-sm font-semibold text-white mb-2">{title}</h3>
      <div className="text-fog-bright text-sm">{body}</div>
    </div>
  );
}
