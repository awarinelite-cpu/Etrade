import { useEffect, useRef, useState } from "react";

const BUY = "#35D07F";
const SELL = "#FF5C5C";
const EMA_LINE = "#F5A623";
const MIN_VISIBLE = 15;

function clamp(n, min, max) {
  return Math.min(Math.max(n, min), max);
}

/**
 * Renders `candles` (oldest first) as an OHLC candlestick chart, with an
 * optional EMA line overlaid (`emaSeries`, same length/order as candles,
 * undefined entries skipped).
 *
 * Supports zoom + pan via a "visible window" (start/count) into the full
 * candle array, rather than always rendering everything:
 * - Pinch with two fingers (or Ctrl/Cmd+scroll / plain scroll on desktop)
 *   to zoom in/out, centered on the gesture's midpoint.
 * - Drag with one finger/mouse to pan left/right through history.
 * - `resetKey` (e.g. `${symbol}:${interval}`) resets the zoom/pan back to
 *   the full view whenever it changes — so switching coins or timeframes
 *   doesn't leave you zoomed into a stale window. Live price ticks that
 *   just update the last candle's close (candles prop changes, resetKey
 *   doesn't) leave the current zoom/pan alone.
 */
export default function CandlestickChart({
  candles,
  emaSeries,
  resetKey,
  width = 600,
  height = 260,
}) {
  const containerRef = useRef(null);
  const pointersRef = useRef(new Map()); // pointerId -> {x, y}
  const pinchRef = useRef(null); // {startDistance, startCount, startCenterIndex}
  const panRef = useRef(null); // {startX, startViewStart}

  const [view, setView] = useState({ start: 0, count: candles?.length || 0 });

  // New coin/timeframe → snap back to the full view. A live-tick update
  // to `candles` (same resetKey) leaves whatever zoom/pan the user set.
  useEffect(() => {
    setView({ start: 0, count: candles?.length || 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  // Native (non-passive) wheel listener — React's synthetic onWheel is
  // passive by default in some browsers, which silently ignores
  // preventDefault and lets the page scroll while you're trying to zoom.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    function onWheel(e) {
      e.preventDefault();
      const total = candles?.length || 0;
      if (total < 2) return;
      const rect = el.getBoundingClientRect();
      const frac = clamp((e.clientX - rect.left) / rect.width, 0, 1);

      setView((v) => {
        const centerIndex = v.start + frac * v.count;
        const zoomFactor = e.deltaY > 0 ? 1.15 : 1 / 1.15;
        const newCount = clamp(
          Math.round(v.count * zoomFactor),
          Math.min(MIN_VISIBLE, total),
          total
        );
        const newStart = clamp(
          Math.round(centerIndex - frac * newCount),
          0,
          Math.max(0, total - newCount)
        );
        return { start: newStart, count: newCount };
      });
    }

    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [candles?.length]);

  function handlePointerDown(e) {
    const total = candles?.length || 0;
    if (total < 2) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointersRef.current.size === 1) {
      panRef.current = { startX: e.clientX, startViewStart: view.start };
      pinchRef.current = null;
    } else if (pointersRef.current.size === 2) {
      const pts = [...pointersRef.current.values()];
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const midX = (pts[0].x + pts[1].x) / 2;
      const rect = containerRef.current.getBoundingClientRect();
      const frac = clamp((midX - rect.left) / rect.width, 0, 1);
      pinchRef.current = {
        startDistance: dist || 1,
        startCount: view.count,
        startCenterIndex: view.start + frac * view.count,
      };
      panRef.current = null;
    }
  }

  function handlePointerMove(e) {
    if (!pointersRef.current.has(e.pointerId)) return;
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const total = candles?.length || 0;
    if (total < 2) return;

    if (pointersRef.current.size >= 2 && pinchRef.current) {
      const pts = [...pointersRef.current.values()].slice(0, 2);
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const scale = dist / pinchRef.current.startDistance;
      const newCount = clamp(
        Math.round(pinchRef.current.startCount / scale),
        Math.min(MIN_VISIBLE, total),
        total
      );
      const newStart = clamp(
        Math.round(pinchRef.current.startCenterIndex - newCount / 2),
        0,
        Math.max(0, total - newCount)
      );
      setView({ start: newStart, count: newCount });
    } else if (pointersRef.current.size === 1 && panRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const deltaXpx = e.clientX - panRef.current.startX;
      const deltaIndex = Math.round((deltaXpx / rect.width) * view.count);
      const newStart = clamp(
        panRef.current.startViewStart - deltaIndex,
        0,
        Math.max(0, total - view.count)
      );
      setView((v) => ({ ...v, start: newStart }));
    }
  }

  function handlePointerUp(e) {
    pointersRef.current.delete(e.pointerId);
    if (pointersRef.current.size < 2) pinchRef.current = null;
    if (pointersRef.current.size === 0) {
      panRef.current = null;
    } else if (pointersRef.current.size === 1) {
      const [remaining] = pointersRef.current.values();
      panRef.current = { startX: remaining.x, startViewStart: view.start };
    }
  }

  if (!candles || candles.length < 2) {
    return (
      <div
        className="flex items-center justify-center text-fog-dim text-sm font-mono"
        style={{ height }}
      >
        No chart data available
      </div>
    );
  }

  const total = candles.length;
  const effectiveCount = clamp(view.count || total, Math.min(MIN_VISIBLE, total), total);
  const effectiveStart = clamp(view.start, 0, Math.max(0, total - effectiveCount));
  const isZoomed = effectiveCount < total;

  const visibleCandles = candles.slice(effectiveStart, effectiveStart + effectiveCount);
  const visibleEma = (emaSeries || []).slice(effectiveStart, effectiveStart + effectiveCount);

  const padTop = 10;
  const padBottom = 10;
  const usableHeight = height - padTop - padBottom;

  const low = Math.min(...visibleCandles.map((c) => c.low));
  const high = Math.max(...visibleCandles.map((c) => c.high));
  const range = high - low || 1;

  const step = width / visibleCandles.length;
  const bodyWidth = Math.max(step * 0.55, 1);

  function y(price) {
    return padTop + usableHeight - ((price - low) / range) * usableHeight;
  }

  const emaPoints = visibleEma
    .map((v, i) => (v !== undefined ? `${(i + 0.5) * step},${y(v)}` : null))
    .filter(Boolean)
    .join(" ");

  return (
    <div
      ref={containerRef}
      className="relative select-none"
      style={{ touchAction: "none" }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      <svg
        width="100%"
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="block"
      >
        {visibleCandles.map((c, i) => {
          const cx = (i + 0.5) * step;
          const up = c.close >= c.open;
          const color = up ? BUY : SELL;
          const bodyTop = y(Math.max(c.open, c.close));
          const bodyBottom = y(Math.min(c.open, c.close));
          const bodyHeight = Math.max(bodyBottom - bodyTop, 1);

          return (
            <g key={c.time}>
              <line
                x1={cx}
                x2={cx}
                y1={y(c.high)}
                y2={y(c.low)}
                stroke={color}
                strokeWidth="1"
              />
              <rect
                x={cx - bodyWidth / 2}
                y={bodyTop}
                width={bodyWidth}
                height={bodyHeight}
                fill={color}
              />
            </g>
          );
        })}

        {emaPoints && (
          <polyline
            points={emaPoints}
            fill="none"
            stroke={EMA_LINE}
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity="0.85"
          />
        )}
      </svg>

      {isZoomed && (
        <button
          type="button"
          onClick={() => setView({ start: 0, count: total })}
          className="absolute top-1 right-1 px-2 py-0.5 text-[10px] font-mono rounded-sm border border-paper-border bg-paper/90 text-fog-dim hover:text-white"
        >
          Reset zoom
        </button>
      )}
    </div>
  );
}
