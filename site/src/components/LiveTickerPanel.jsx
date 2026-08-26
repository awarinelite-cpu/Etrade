import { useEffect, useRef, useState } from "react";
import { useLivePrices } from "../hooks/useLivePrices";
import Sparkline from "./Sparkline";

// Back to the 4 majors as a fixed 2x2 grid of big cards. The 14-coin
// carousel (basis-[22%] cards, 4 squeezed into one row) made the cards
// too small to read on mobile — this is the full set of coins available
// as alert assets elsewhere, but the ticker panel itself only ever
// needs to show the majors at a readable size.
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
    <div className="grid grid-cols-2 gap-3">
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
            data-ticker-card
            className="rounded-xl border border-paper-border bg-paper p-4 flex flex-col gap-2"
          >
            <div className="flex items-center justify-between gap-1">
              <span className="text-sm font-mono text-fog-dim">{symbol}</span>
              {changeLabel && (
                <span className={`text-sm font-mono ${changeColor}`}>
                  {changeLabel}
                </span>
              )}
            </div>
            <span className="font-mono text-2xl sm:text-3xl text-white font-tabular truncate">
              {formatPrice(price)}
            </span>
            <div className="mt-1 w-full">
              <Sparkline data={history} width={160} height={48} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
