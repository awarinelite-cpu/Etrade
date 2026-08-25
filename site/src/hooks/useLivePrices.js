import { useEffect, useRef, useState } from "react";
import { getAssetPrices } from "../lib/prices";

/**
 * Polls current prices for the given symbols every `intervalMs`.
 * Symbols are deduped and re-fetched whenever the set changes.
 */
export function useLivePrices(symbols, intervalMs = 20000) {
  const [prices, setPrices] = useState({});
  const key = [...new Set(symbols)].sort().join(",");
  const timerRef = useRef(null);

  useEffect(() => {
    if (!key) {
      setPrices({});
      return;
    }
    const uniqueSymbols = key.split(",");

    let cancelled = false;
    async function tick() {
      try {
        const result = await getAssetPrices(uniqueSymbols);
        if (!cancelled) setPrices((prev) => ({ ...prev, ...result }));
      } catch (err) {
        console.error("Price fetch failed:", err);
      }
    }

    tick();
    timerRef.current = setInterval(tick, intervalMs);
    return () => {
      cancelled = true;
      clearInterval(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, intervalMs]);

  return prices;
}
