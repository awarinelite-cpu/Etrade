const admin = require("firebase-admin");
const { getAssetPrices, isSupportedAsset, ALL_SUPPORTED_SYMBOLS } = require("./assets");

const FREE_TIER_ALERT_LIMIT = 3;

function db() {
  return admin.firestore();
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
async function createAlert({ chatId, coin, condition, targetPrice, label, repeat }) {
  coin = String(coin || "").toUpperCase();
  condition = String(condition || "").toLowerCase();
  targetPrice = Number(targetPrice);
  label = label ? String(label).toUpperCase() : null;
  repeat = Boolean(repeat);

  if (!isSupportedAsset(coin)) {
    return {
      ok: false,
      error: `Unsupported asset "${coin}". Supported: ${ALL_SUPPORTED_SYMBOLS.join(", ")}`,
    };
  }
  if (!["above", "below"].includes(condition)) {
    return { ok: false, error: 'Condition must be "above" or "below".' };
  }
  if (isNaN(targetPrice) || targetPrice <= 0) {
    return { ok: false, error: "Target price must be a positive number." };
  }
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
      targetPrice,
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
async function updateAlert({ id, chatId, condition, targetPrice, label, repeat }) {
  const ref = db().collection("alerts").doc(id);
  const doc = await ref.get();

  if (!doc.exists) return { ok: false, error: "Alert not found." };
  if (doc.data().chatId !== String(chatId)) {
    return { ok: false, error: "This alert doesn't belong to that chat ID." };
  }

  const updates = {};

  if (condition !== undefined) {
    condition = String(condition).toLowerCase();
    if (!["above", "below"].includes(condition)) {
      return { ok: false, error: 'Condition must be "above" or "below".' };
    }
    updates.condition = condition;
  }

  if (targetPrice !== undefined) {
    targetPrice = Number(targetPrice);
    if (isNaN(targetPrice) || targetPrice <= 0) {
      return { ok: false, error: "Target price must be a positive number." };
    }
    updates.targetPrice = targetPrice;
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
  createAlert,
  updateAlert,
  deleteAlert,
  isPaidUser,
};
