const fetch = require("node-fetch");

const PAYSTACK_API = "https://api.paystack.co";

// Set with: firebase functions:secrets:set PAYSTACK_SECRET_KEY
const SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;

// Naira amount for the upgrade. Paystack takes amounts in kobo (x100).
// Adjust to whatever price you land on.
const UPGRADE_AMOUNT_NGN = 2000;

/**
 * Start a Paystack transaction for a chatId and return the checkout URL to
 * send the user. We don't have their email (Telegram doesn't give us one),
 * so we use a placeholder — Paystack allows this for card/bank transfer
 * checkout, it's just not used to email a receipt.
 */
async function initializeUpgrade(chatId) {
  const res = await fetch(`${PAYSTACK_API}/transaction/initialize`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SECRET_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      // Paystack requires a syntactically valid email but doesn't verify
      // deliverability, and we don't have the user's real email (Telegram
      // doesn't give us one) — using a fake-but-valid-looking address tied
      // to their chatId is the standard workaround. Reserved TLDs like
      // ".invalid" or ".example" get rejected by Paystack's validator, so
      // use a real domain we control instead.
      email: `telegram-${chatId}@e-topaz.vercel.app`,
      amount: UPGRADE_AMOUNT_NGN * 100,
      currency: "NGN",
      metadata: { chatId: String(chatId) },
      // Paystack requires a callback_url and appends its own tracking
      // query params (?trxref=...&reference=...) to whatever we set here.
      // Pointing straight at a t.me link breaks in some Telegram clients
      // once those extra params are tacked on ("username not found"), so
      // land on our own success page instead, which has a clean link.
      callback_url: "https://e-topaz.vercel.app/upgrade-success",
    }),
  });
  const data = await res.json();
  if (!data.status) {
    throw new Error(data.message || "Paystack initialize failed");
  }
  return {
    authorizationUrl: data.data.authorization_url,
    reference: data.data.reference,
  };
}

/**
 * Verify a transaction reference directly with Paystack (never trust the
 * webhook payload's "success" claim alone — always re-check server to
 * server) and return the chatId it was for if the payment succeeded.
 */
async function verifyTransaction(reference) {
  const res = await fetch(
    `${PAYSTACK_API}/transaction/verify/${encodeURIComponent(reference)}`,
    { headers: { Authorization: `Bearer ${SECRET_KEY}` } }
  );
  const data = await res.json();
  if (!data.status) {
    throw new Error(data.message || "Paystack verify failed");
  }
  const tx = data.data;
  const chatId = tx.metadata && tx.metadata.chatId;
  return {
    success: tx.status === "success",
    chatId: chatId ? String(chatId) : null,
    amount: tx.amount,
    reference: tx.reference,
  };
}

module.exports = { initializeUpgrade, verifyTransaction, UPGRADE_AMOUNT_NGN };
