import { useLivePrices } from "../hooks/useLivePrices";
import LivePrice from "./LivePrice";

// A small, fixed set of majors so the nav shows something live even
// before the user has any alerts set. Keep this short, it's a nav strip,
// not the dashboard grid.
const TICKER_SYMBOLS = ["BTC", "ETH", "SOL", "XRP"];

export default function PriceTicker() {
  const prices = useLivePrices(TICKER_SYMBOLS);

  return (
    <div className="flex items-center gap-4 overflow-x-auto">
      {TICKER_SYMBOLS.map((symbol) => (
        <div key={symbol} className="flex items-baseline gap-1.5 shrink-0">
          <span className="text-xs font-mono text-fog-dim">{symbol}</span>
          <LivePrice price={prices[symbol]} />
        </div>
      ))}
    </div>
  );
}
