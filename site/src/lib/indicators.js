// RSI + MACD + trend, computed client-side from Binance candle closes.
// Deliberately just these three (not the full Ichimoku/Supertrend/BB/ATR
// stack) — enough to give a fast read on momentum and direction without
// building a full TA engine.

function computeSMASeries(values, period) {
  const out = new Array(values.length).fill(undefined);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

export function computeEMASeries(values, period) {
  const out = new Array(values.length).fill(undefined);
  if (values.length < period) return out;
  const k = 2 / (period + 1);
  // Seed the first EMA value with a plain SMA of the first `period` values,
  // then smooth forward from there — the standard approach.
  let prev = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

// Wilder's smoothing, the standard RSI method.
function computeRSISeries(closes, period = 14) {
  const out = new Array(closes.length).fill(undefined);
  if (closes.length < period + 1) return out;

  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) avgGain += diff;
    else avgLoss -= diff;
  }
  avgGain /= period;
  avgLoss /= period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

function computeMACDSeries(closes, fast = 12, slow = 26, signalPeriod = 9) {
  const emaFast = computeEMASeries(closes, fast);
  const emaSlow = computeEMASeries(closes, slow);
  const macdLine = closes.map((_, i) =>
    emaFast[i] !== undefined && emaSlow[i] !== undefined
      ? emaFast[i] - emaSlow[i]
      : undefined
  );

  // Signal line is a 9-EMA of the MACD line itself — but computeEMASeries
  // needs a dense array, so run it on just the defined MACD values, then
  // map the result back to full-length, offset by how many leading
  // undefined slots the MACD line had.
  const firstDefined = macdLine.findIndex((v) => v !== undefined);
  const denseMacd = firstDefined === -1 ? [] : macdLine.slice(firstDefined);
  const denseSignal = computeEMASeries(denseMacd, signalPeriod);
  const signalLine = new Array(macdLine.length).fill(undefined);
  for (let i = 0; i < denseSignal.length; i++) {
    if (denseSignal[i] !== undefined) signalLine[firstDefined + i] = denseSignal[i];
  }

  const histogram = macdLine.map((v, i) =>
    v !== undefined && signalLine[i] !== undefined ? v - signalLine[i] : undefined
  );

  return { macdLine, signalLine, histogram };
}

/**
 * Latest RSI, MACD, and EMA/SMA trend read for a candle series.
 * @param {Array<{close:number}>} candles - oldest first
 * @returns {null | {
 *   rsi: number, rsiLabel: "Overbought"|"Oversold"|"Neutral",
 *   macd: number, signal: number, histogram: number, macdLabel: "Bullish"|"Bearish",
 *   ema20: number, sma50: number, trendLabel: "Uptrend"|"Downtrend"
 * }} null if there isn't enough history yet (needs 50+ candles for the SMA50 leg).
 */
export function getIndicatorSnapshot(candles) {
  const closes = candles.map((c) => c.close);
  if (closes.length < 51) return null;

  const lastIdx = closes.length - 1;
  const rsiSeries = computeRSISeries(closes, 14);
  const { macdLine, signalLine, histogram } = computeMACDSeries(closes);
  const ema20Series = computeEMASeries(closes, 20);
  const sma50Series = computeSMASeries(closes, 50);

  const rsi = rsiSeries[lastIdx];
  const macd = macdLine[lastIdx];
  const signal = signalLine[lastIdx];
  const hist = histogram[lastIdx];
  const ema20 = ema20Series[lastIdx];
  const sma50 = sma50Series[lastIdx];

  if ([rsi, macd, signal, ema20, sma50].some((v) => v === undefined)) return null;

  return {
    rsi,
    rsiLabel: rsi >= 70 ? "Overbought" : rsi <= 30 ? "Oversold" : "Neutral",
    macd,
    signal,
    histogram: hist,
    macdLabel: macd > signal ? "Bullish" : "Bearish",
    ema20,
    sma50,
    trendLabel: ema20 > sma50 ? "Uptrend" : "Downtrend",
  };
}
