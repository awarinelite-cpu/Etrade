import { useEffect, useRef, useState } from "react";
import { useLivePrices } from "../hooks/useLivePrices";
import { COIN_SYMBOLS } from "../lib/prices";
import Sparkline from "./Sparkline";

// All 14 coins, kept big and readable by paging 4-per-screen (2x2 grid)
// instead of shrinking every card to fit them all in one row. Same card
// size/styling as the original 4-major design — just paginated.
const TICKER_SYMBOLS = COIN_SYMBOLS;
const CARDS_PER_PAGE = 4;

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
  const [page, setPage] = useState(0);
  const pageCount = Math.ceil(TICKER_SYMBOLS.length / CARDS_PER_PAGE);

  function goToPage(next) {
    setPage(((next % pageCount) + pageCount) % pageCount);
  }

  const visibleSymbols = TICKER_SYMBOLS.slice(
    page * CARDS_PER_PAGE,
    page * CARDS_PER_PAGE + CARDS_PER_PAGE
  );

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
    <div className="relative">
      <div className="grid grid-cols-2 gap-3">
      {visibleSymbols.map((symbol) => {
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

      {pageCount > 1 && (
        <div className="flex items-center justify-center gap-4 mt-3">
          <button
            type="button"
            aria-label="Previous page"
            onClick={() => goToPage(page - 1)}
            className="flex items-center justify-center w-7 h-7 rounded-full border border-paper-border bg-paper text-fog-dim hover:text-white"
          >
            ‹
          </button>
          <div className="flex items-center gap-1.5">
            {Array.from({ length: pageCount }).map((_, i) => (
              <button
                key={i}
                type="button"
                aria-label={`Go to page ${i + 1}`}
                onClick={() => goToPage(i)}
                className={`w-1.5 h-1.5 rounded-full transition-colors ${
                  i === page ? "bg-white" : "bg-paper-border"
                }`}
              />
            ))}
          </div>
          <button
            type="button"
            aria-label="Next page"
            onClick={() => goToPage(page + 1)}
            className="flex items-center justify-center w-7 h-7 rounded-full border border-paper-border bg-paper text-fog-dim hover:text-white"
          >
            ›
          </button>
        </div>
      )}
    </div>
  );
}
