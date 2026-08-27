const admin = require("firebase-admin");
const { getAssetPrices, isSupportedAsset, ALL_SUPPORTED_SYMBOLS } = require("./assets");

const FREE_TIER_ALERT_LIMIT = 3;

// Price alerts compare directly against a target price (unchanged).
// RSI/MACD alerts read off a candle series at some timeframe. Percent-move
// alerts compare price now vs. price N minutes ago. All three share the
// same armed/repeat/one-shot firing mechanics in checkPrices — only how
// "is this condition currently true" gets computed differs per category.
const PRICE_CONDITIONS = ["above", "below"];
const RSI_CONDITIONS = ["rsi_below", "rsi_above"];
const MACD_CONDITIONS = ["macd_bullish_cross", "macd_bearish_cross"];
const ALL_CONDITIONS = [...PRICE_CONDITIONS, ...RSI_CONDITIONS, ...MACD_CONDITIONS, "percent_move"];

// Timeframe options for RSI/MACD alerts — deliberately a small subset of
// what the coin-detail chart offers, since very short timeframes (1m/5m)
// produce noisy indicator crosses that aren't useful as alert triggers.
const INDICATOR_INTERVALS = ["15m", "1h", "4h", "1d"];
const DEFAULT_INDICATOR_INTERVAL = "1h";

const MIN_WINDOW_MINUTES = 5;
const MAX_WINDOW_MINUTES = 1440; // 24h — longer than that, just use a price alert instead.
const DEFAULT_WINDOW_MINUTES = 60;

function db() {
  return admin.firestore();
}

/**
 * Validates and normalizes the condition-specific fields for a create/update
 * call. Returns { ok: true, fields } with only the fields relevant to this
 * condition populated (others explicitly null so stale values from an
 * earlier condition type don't linger on update), or { ok: false, error }.
 */
function validateConditionFields(condition, { targetPrice, threshold, indicatorInterval, windowMinutes }) {
  if (PRICE_CONDITIONS.includes(condition)) {
    const price = Number(targetPrice);
    if (isNaN(price) || price <= 0) {
      return { ok: false, error: "Target price must be a positive number." };
    }
    return {
      ok: true,
      fields: { targetPrice: price, threshold: null, indicatorInterval: null, windowMinutes: null },
    };
  }

  if (RSI_CONDITIONS.includes(condition)) {
    const rsiThreshold = Number(threshold);
    if (isNaN(rsiThreshold) || rsiThreshold < 0 || rsiThreshold > 100) {
      return { ok: false, error: "RSI threshold must be between 0 and 100." };
    }
    const interval = indicatorInterval || DEFAULT_INDICATOR_INTERVAL;
    if (!INDICATOR_INTERVALS.includes(interval)) {
      return {
        ok: false,
        error: `Timeframe must be one of: ${INDICATOR_INTERVALS.join(", ")}.`,
      };
    }
    return {
      ok: true,
      fields: { targetPrice: null, threshold: rsiThreshold, indicatorInterval: interval, windowMinutes: null },
    };
  }

  if (MACD_CONDITIONS.includes(condition)) {
    const interval = indicatorInterval || DEFAULT_INDICATOR_INTERVAL;
    if (!INDICATOR_INTERVALS.includes(interval)) {
      return {
        ok: false,
        error: `Timeframe must be one of: ${INDICATOR_INTERVALS.join(", ")}.`,
      };
    }
    return {
      ok: true,
      fields: { targetPrice: null, threshold: null, indicatorInterval: interval, windowMinutes: null },
    };
  }

  if (condition === "percent_move") {
    const percentThreshold = Number(threshold);
    if (isNaN(percentThreshold) || percentThreshold <= 0) {
      return { ok: false, error: "Percent move must be a positive number." };
    }
    const window = windowMinutes === undefined ? DEFAULT_WINDOW_MINUTES : Number(windowMinutes);
    if (isNaN(window) || window < MIN_WINDOW_MINUTES || window > MAX_WINDOW_MINUTES) {
      return {
        ok: false,
        error: `Window must be between ${MIN_WINDOW_MINUTES} and ${MAX_WINDOW_MINUTES} minutes.`,
      };
    }
    return {
      ok: true,
      fields: { targetPrice: null, threshold: percentThreshold, indicatorInterval: null, windowMinutes: window },
    };
  }

  return { ok: false, error: `Unknown condition "${condition}".` };
}

async function isPaidUser(chatId) {
  const doc = await db().collection("telegram_users").doc(String(chatId)).get();
  return Boolean(doc.exists && doc.data().isPaid);
}

/**
 * Validate and create a new alert. Used by both the Telegram /alert command
 * and the web dashboard's create-alert form, so the two stay in sync on
 * limits, supported assets, and stored shape.
 * @returns {Promise<{ok: true, id: string, currentPrice?: number} | {ok: false, error: string}>}
 */
async function createAlert({
  chatId,
  coin,
  condition,
  targetPrice,
  threshold,
  indicatorInterval,
  windowMinutes,
  label,
  repeat,
}) {
  coin = String(coin || "").toUpperCase();
  condition = String(condition || "").toLowerCase();
  label = label ? String(label).toUpperCase() : null;
  repeat = Boolean(repeat);

  if (!isSupportedAsset(coin)) {
    return {
      ok: false,
      error: `Unsupported asset "${coin}". Supported: ${ALL_SUPPORTED_SYMBOLS.join(", ")}`,
    };
  }
  if (!ALL_CONDITIONS.includes(condition)) {
    return { ok: false, error: `Condition must be one of: ${ALL_CONDITIONS.join(", ")}.` };
  }
  const validated = validateConditionFields(condition, {
    targetPrice,
    threshold,
    indicatorInterval,
    windowMinutes,
  });
  if (!validated.ok) return validated;
  if (label && !["BUY", "SELL"].includes(label)) {
    return { ok: false, error: 'Label must be "BUY" or "SELL" if provided.' };
  }

  const existingAlerts = await db()
    .collection("alerts")
    .where("chatId", "==", String(chatId))
    .where("active", "==", true)
    .get();

  const isPaid = await isPaidUser(chatId);
  if (!isPaid && existingAlerts.size >= FREE_TIER_ALERT_LIMIT) {
    return {
      ok: false,
      error: `Free plan allows up to ${FREE_TIER_ALERT_LIMIT} active alerts. Delete one, or send /upgrade for unlimited.`,
    };
  }

  const docRef = await db()
    .collection("alerts")
    .add({
      chatId: String(chatId),
      coin,
      condition,
      ...validated.fields,
      label,
      repeat,
      armed: true,
      active: true,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      lastTriggeredAt: null,
    });

  let currentPrice;
  try {
    const prices = await getAssetPrices([coin]);
    currentPrice = prices[coin];
  } catch {
    // best-effort only — creation already succeeded
  }

  return { ok: true, id: docRef.id, currentPrice };
}

/**
 * Update an existing alert's condition/target/label/repeat. Requires the
 * caller to know both the alert id AND the chatId it belongs to — this is
 * the same "unlisted-link" privacy model the rest of the app already uses
 * (see firestore.rules), not real authentication.
 */
async function updateAlert({
  id,
  chatId,
  condition,
  targetPrice,
  threshold,
  indicatorInterval,
  windowMinutes,
  label,
  repeat,
}) {
  const ref = db().collection("alerts").doc(id);
  const doc = await ref.get();

  if (!doc.exists) return { ok: false, error: "Alert not found." };
  const existing = doc.data();
  if (existing.chatId !== String(chatId)) {
    return { ok: false, error: "This alert doesn't belong to that chat ID." };
  }

  const updates = {};

  // Changing the condition — or any of a condition's own fields — always
  // re-validates against whichever condition is now in effect (the new
  // one if provided, otherwise the alert's existing one), since a
  // targetPrice edit means nothing for an RSI alert and vice versa.
  const conditionFieldsTouched =
    targetPrice !== undefined ||
    threshold !== undefined ||
    indicatorInterval !== undefined ||
    windowMinutes !== undefined;

  if (condition !== undefined || conditionFieldsTouched) {
    const effectiveCondition = condition !== undefined ? String(condition).toLowerCase() : existing.condition;
    if (!ALL_CONDITIONS.includes(effectiveCondition)) {
      return { ok: false, error: `Condition must be one of: ${ALL_CONDITIONS.join(", ")}.` };
    }
    const validated = validateConditionFields(effectiveCondition, {
      targetPrice: targetPrice !== undefined ? targetPrice : existing.targetPrice,
      threshold: threshold !== undefined ? threshold : existing.threshold,
      indicatorInterval: indicatorInterval !== undefined ? indicatorInterval : existing.indicatorInterval,
      windowMinutes: windowMinutes !== undefined ? windowMinutes : existing.windowMinutes,
    });
    if (!validated.ok) return validated;
    updates.condition = effectiveCondition;
    Object.assign(updates, validated.fields);
  }

  if (label !== undefined) {
    const normalized = label ? String(label).toUpperCase() : null;
    if (normalized && !["BUY", "SELL"].includes(normalized)) {
      return { ok: false, error: 'Label must be "BUY" or "SELL" if provided.' };
    }
    updates.label = normalized;
  }

  if (repeat !== undefined) {
    updates.repeat = Boolean(repeat);
  }

  // Any edit to condition/target re-arms the alert, since the old
  // triggered/armed state no longer describes the new threshold.
  if (updates.condition !== undefined || updates.targetPrice !== undefined) {
    updates.armed = true;
  }

  await ref.update(updates);
  return { ok: true, id };
}

/** Soft-deletes (deactivates) an alert. Same chatId ownership check as updateAlert. */
async function deleteAlert({ id, chatId }) {
  const ref = db().collection("alerts").doc(id);
  const doc = await ref.get();

  if (!doc.exists) return { ok: false, error: "Alert not found." };
  if (doc.data().chatId !== String(chatId)) {
    return { ok: false, error: "This alert doesn't belong to that chat ID." };
  }

  await ref.update({ active: false });
  return { ok: true, id };
}

module.exports = {
  FREE_TIER_ALERT_LIMIT,
  PRICE_CONDITIONS,
  RSI_CONDITIONS,
  MACD_CONDITIONS,
  ALL_CONDITIONS,
  INDICATOR_INTERVALS,
  DEFAULT_INDICATOR_INTERVAL,
  MIN_WINDOW_MINUTES,
  MAX_WINDOW_MINUTES,
  DEFAULT_WINDOW_MINUTES,
  createAlert,
  updateAlert,
  deleteAlert,
  isPaidUser,
};
