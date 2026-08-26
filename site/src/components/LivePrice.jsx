import { useEffect, useRef, useState } from "react";

const FLASH_MS = 600;

function formatPrice(n) {
  if (typeof n !== "number") return "—";
  return `$${n.toLocaleString()}`;
}

function formatChange(pct) {
  if (typeof pct !== "number" || !Number.isFinite(pct)) return null;
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(2)}%`;
}

/**
 * A single live-ticking price, styled like TradingView's watchlist rows:
 * briefly flashes green on an uptick / red on a downtick, then settles
 * back to neutral, plus a running percent-change badge measured from the
 * first price seen this session.
 */
export default function LivePrice({ price }) {
  const [flash, setFlash] = useState(null); // "up" | "down" | null
  const prevPrice = useRef(null);
  const sessionOpenPrice = useRef(null);
  const flashTimer = useRef(null);

  useEffect(() => {
    if (typeof price !== "number") return;

    if (sessionOpenPrice.current === null) {
      sessionOpenPrice.current = price;
    }

    if (prevPrice.current !== null && price !== prevPrice.current) {
      setFlash(price > prevPrice.current ? "up" : "down");
      clearTimeout(flashTimer.current);
      flashTimer.current = setTimeout(() => setFlash(null), FLASH_MS);
    }

    prevPrice.current = price;
    return () => clearTimeout(flashTimer.current);
  }, [price]);

  const pct =
    typeof price === "number" && sessionOpenPrice.current
      ? ((price - sessionOpenPrice.current) / sessionOpenPrice.current) * 100
      : null;
  const changeLabel = formatChange(pct);

  const colorClass =
    flash === "up" ? "text-buy" : flash === "down" ? "text-sell" : "text-fog";

  return (
    <span className="flex items-baseline gap-1.5 font-mono text-sm font-tabular">
      <span className={`transition-colors duration-300 ${colorClass}`}>
        {formatPrice(price)}
      </span>
      {changeLabel && (
        <span
          className={`text-xs ${
            pct > 0 ? "text-buy" : pct < 0 ? "text-sell" : "text-fog-dim"
          }`}
        >
          {changeLabel}
        </span>
      )}
    </span>
  );
}
