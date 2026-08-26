import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import CandlestickChart from "../components/CandlestickChart";
import { useLivePrices } from "../hooks/useLivePrices";
import { fetchKlines } from "../lib/binance";
import { computeEMASeries, getIndicatorSnapshot } from "../lib/indicators";
import { isSupportedSymbol } from "../lib/prices";

const INTERVALS = [
  { value: "1m", label: "1M" },
  { value: "5m", label: "5M" },
  { value: "15m", label: "15M" },
  { value: "30m", label: "30M" },
  { value: "1h", label: "1H" },
  { value: "4h", label: "4H" },
  { value: "1d", label: "1D" },
  { value: "1w", label: "1W" },
];

// How many candles to request per interval — enough to show a
// reasonable stretch of history without over-fetching. Minute-level
// intervals need more candles just to cover a few hours/days; the
// coarser ones are fine with fewer since each candle already spans more
// time.
const CANDLE_LIMIT_BY_INTERVAL = {
  "1m": 300, // ~5 hours
  "5m": 288, // ~24 hours
  "15m": 288, // ~3 days
  "30m": 240, // ~5 days
};
const DEFAULT_CANDLE_LIMIT = 180;

function formatPrice(n) {
  if (typeof n !== "number") return "—";
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: n < 10 ? 4 : 2 })}`;
}

export default function CoinDetail() {
  const { symbol: rawSymbol } = useParams();
  const symbol = (rawSymbol || "").toUpperCase();
  const navigate = useNavigate();

  const [interval, setInterval_] = useState("1d");
  const [candles, setCandles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  const prices = useLivePrices(isSupportedSymbol(symbol) ? [symbol] : []);
  const price = prices[symbol];

  useEffect(() => {
    if (!isSupportedSymbol(symbol)) {
      setLoading(false);
      setLoadError("Chart isn't available for this asset.");
      return;
    }
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    const limit = CANDLE_LIMIT_BY_INTERVAL[interval] || DEFAULT_CANDLE_LIMIT;
    fetchKlines(symbol, interval, limit).then((result) => {
      if (cancelled) return;
      setLoading(false);
      if (result.length === 0) {
        setLoadError(
          "Couldn't load chart data right now. Try again in a bit."
        );
      }
      setCandles(result);
    });

    // Re-sync with real Binance candles periodically so a newly-closed
    // candle (e.g. the hour/day actually rolled over) replaces the
    // in-progress one instead of the chart drifting from ground truth
    // forever. Live price ticks (below) handle the second-to-second
    // movement in between syncs. Minute-level intervals resync faster
    // since a candle closes so much sooner at that granularity.
    const resyncMs = interval === "1m" || interval === "5m" ? 15000 : 45000;
    const resyncId = setInterval(() => {
      fetchKlines(symbol, interval, limit).then((result) => {
        if (!cancelled && result.length > 0) setCandles(result);
      });
    }, resyncMs);

    return () => {
      cancelled = true;
      clearInterval(resyncId);
    };
  }, [symbol, interval]);

  // Live price ticks (useLivePrices polls every 3s) update the
  // in-progress candle's close/high/low in place — this is what makes
  // the chart visibly move as the price moves, rather than only
  // changing every time a full candle closes.
  useEffect(() => {
    if (typeof price !== "number") return;
    setCandles((prev) => {
      if (prev.length === 0) return prev;
      const last = prev[prev.length - 1];
      if (last.close === price) return prev;
      const updated = {
        ...last,
        close: price,
        high: Math.max(last.high, price),
        low: Math.min(last.low, price),
      };
      return [...prev.slice(0, -1), updated];
    });
  }, [price]);

  const snapshot = candles.length ? getIndicatorSnapshot(candles) : null;
  const ema20Series = candles.length
    ? computeEMASeries(candles.map((c) => c.close), 20)
    : [];

  const openPrice = candles[0]?.open;
  const changePct =
    typeof price === "number" && openPrice
      ? ((price - openPrice) / openPrice) * 100
      : null;

  if (!isSupportedSymbol(symbol)) {
    return (
      <div className="min-h-screen px-6 flex flex-col items-center justify-center text-center gap-3">
        <p className="text-fog">Unknown asset "{symbol}".</p>
        <Link to="/dashboard" className="text-buy text-sm font-mono">
          ← Back to dashboard
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen px-6 pb-16">
      <header className="max-w-3xl mx-auto pt-6 flex items-center gap-3">
        <button
          onClick={() => navigate(-1)}
          aria-label="Back"
          className="flex items-center justify-center w-8 h-8 rounded-full border border-paper-border text-fog-dim hover:text-white transition-colors"
        >
          ‹
        </button>
        <span className="font-display font-semibold text-white">{symbol}</span>
        <span className="text-xs font-mono text-fog-dim">/ USD</span>
      </header>

      <div className="max-w-3xl mx-auto mt-6">
        <div className="mb-3">
          <div className="font-mono text-3xl text-white font-tabular">
            {formatPrice(price)}
          </div>
          {changePct !== null && (
            <div
              className={`text-sm font-mono mt-1 ${
                changePct > 0 ? "text-buy" : changePct < 0 ? "text-sell" : "text-fog-dim"
              }`}
            >
              {changePct > 0 ? "+" : ""}
              {changePct.toFixed(2)}% this window
            </div>
          )}
        </div>

        <div className="flex gap-1 overflow-x-auto pb-1 mb-4 -mx-1 px-1 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
          {INTERVALS.map((i) => (
            <button
              key={i.value}
              onClick={() => setInterval_(i.value)}
              className={`shrink-0 px-2.5 py-1 text-xs font-mono rounded-sm border transition-colors ${
                interval === i.value
                  ? "border-buy text-white bg-buy/10"
                  : "border-paper-border text-fog-dim hover:text-fog-bright"
              }`}
            >
              {i.label}
            </button>
          ))}
        </div>

        <div className="rounded-md border border-paper-border bg-paper p-3">
          {loading ? (
            <div className="flex items-center justify-center h-[260px] text-fog-dim text-sm font-mono">
              Loading chart…
            </div>
          ) : loadError ? (
            <div className="flex items-center justify-center h-[260px] text-center text-fog-dim text-sm font-mono px-6">
              {loadError}
            </div>
          ) : (
            <CandlestickChart
              candles={candles}
              emaSeries={ema20Series}
              resetKey={`${symbol}:${interval}`}
            />
          )}
        </div>
        {!loading && !loadError && (
          <p className="text-[11px] font-mono text-fog-dim mt-2">
            Pinch or scroll to zoom, drag to pan.
          </p>
        )}

        <div className="grid grid-cols-3 gap-3 mt-4">
          <IndicatorCard
            label="RSI (14)"
            value={snapshot ? snapshot.rsi.toFixed(1) : "—"}
            tag={snapshot?.rsiLabel}
            tagColor={
              snapshot?.rsiLabel === "Overbought"
                ? "text-sell"
                : snapshot?.rsiLabel === "Oversold"
                ? "text-buy"
                : "text-fog-dim"
            }
          />
          <IndicatorCard
            label="MACD"
            value={snapshot ? snapshot.macd.toFixed(2) : "—"}
            tag={snapshot?.macdLabel}
            tagColor={snapshot?.macdLabel === "Bullish" ? "text-buy" : "text-sell"}
          />
          <IndicatorCard
            label="Trend"
            value={
              snapshot
                ? `EMA20 ${snapshot.ema20 > snapshot.sma50 ? ">" : "<"} SMA50`
                : "—"
            }
            tag={snapshot?.trendLabel}
            tagColor={snapshot?.trendLabel === "Uptrend" ? "text-buy" : "text-sell"}
          />
        </div>
        {!snapshot && !loading && !loadError && (
          <p className="text-xs font-mono text-fog-dim mt-3">
            Not enough history yet at this interval to compute indicators — try a
            longer timeframe (1D or 1W).
          </p>
        )}
      </div>
    </div>
  );
}

function IndicatorCard({ label, value, tag, tagColor }) {
  return (
    <div className="rounded-md border border-paper-border bg-paper p-3 flex flex-col gap-1">
      <span className="text-[11px] font-mono text-fog-dim">{label}</span>
      <span className="font-mono text-base text-white font-tabular truncate">
        {value}
      </span>
      {tag && (
        <span className={`text-[11px] font-mono ${tagColor}`}>{tag}</span>
      )}
    </div>
  );
}
