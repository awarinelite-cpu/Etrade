import { useEffect, useRef, useState } from "react";
import { useLivePrices } from "../hooks/useLivePrices";
import Sparkline from "./Sparkline";

// Same fixed set of majors as before, shown before any alerts exist too.
const TICKER_SYMBOLS = ["BTC", "ETH", "SOL", "XRP"];

// How many ticks to keep per symbol for the sparkline. At the 3s poll
// interval this is a ~2 minute rolling window, long enough to show real
// movement without the chart feeling laggy or memory growing unbounded.
const MAX_HISTORY_POINTS = 40;

function formatPrice(n) {
  if (typeof n !== "number") return "—";
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: n < 10 ? 4 : 2 })}`;
}

function formatChange(pct) {
  if (typeof pct !== "number" || !Number.isFinite(pct)) return null;
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(2)}%`;
}

/**
 * The big live-ticking panel that fills the top of the dashboard: one
 * card per symbol with the current price, session percent change, and a
 * sparkline chart of recent ticks — the "graph movement as it changes"
 * TradingView-style piece. History is accumulated client-side as polls
 * come in (there's no historical-price endpoint), so the chart is a
 * rolling window of this session's ticks, not a persisted 24h chart.
 */
export default function LiveTickerPanel() {
  const prices = useLivePrices(TICKER_SYMBOLS, 3000);
  const historyRef = useRef({});
  const [, bumpVersion] = useState(0);

  useEffect(() => {
    let changed = false;
    for (const symbol of TICKER_SYMBOLS) {
      const price = prices[symbol];
      if (typeof price !== "number") continue;
      const existing = historyRef.current[symbol] || [];
      if (existing[existing.length - 1] === price) continue;
      historyRef.current[symbol] = [...existing, price].slice(
        -MAX_HISTORY_POINTS
      );
      changed = true;
    }
    if (changed) bumpVersion((n) => n + 1);
  }, [prices]);

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {TICKER_SYMBOLS.map((symbol) => {
        const history = historyRef.current[symbol] || [];
        const price = prices[symbol];
        const openPrice = history[0];
        const pct =
          typeof price === "number" && openPrice
            ? ((price - openPrice) / openPrice) * 100
            : null;
        const changeLabel = formatChange(pct);
        const changeColor =
          pct > 0 ? "text-buy" : pct < 0 ? "text-sell" : "text-fog-dim";

        return (
          <div
            key={symbol}
            className="rounded-md border border-paper-border bg-paper p-3 flex flex-col gap-1"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono text-fog-dim">{symbol}</span>
              {changeLabel && (
                <span className={`text-xs font-mono ${changeColor}`}>
                  {changeLabel}
                </span>
              )}
            </div>
            <span className="font-mono text-lg text-white font-tabular">
              {formatPrice(price)}
            </span>
            <div className="mt-1">
              <Sparkline data={history} width={140} height={36} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
