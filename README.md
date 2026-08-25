# Crypto Alert Bot (Telegram)

A Telegram bot that watches crypto prices and messages you when a coin hits
a price you set. No trading, no funds handled — just alerts.

## How it works

- **`telegramWebhook`** — receives messages from Telegram, handles commands
  like `/alert`, `/myalerts`, `/delete`.
- **`checkPrices`** — runs every minute, fetches current prices from
  CoinGecko's free API, checks them against all active alerts in Firestore,
  and messages users whose alerts have triggered.

## One-time setup

### 1. Create a Firebase project
- Go to https://console.firebase.google.com
- Create a new project
- Enable **Firestore** (in Native mode)
- Enable **Cloud Functions** (requires the Blaze pay-as-you-go plan — the
  free tier of Blaze covers a small bot's usage, but you must add a billing
  method)

### 2. Create your Telegram bot
- Open Telegram, message **@BotFather**
- Send `/newbot`, follow the prompts, name it whatever you like
- BotFather gives you a **bot token** — save it, you'll need it below

### 3. Install the Firebase CLI (on your machine)
```bash
npm install -g firebase-tools
firebase login
```

### 4. Link this project to your Firebase project
```bash
cd btc-alert-bot
firebase use --add
# select your Firebase project when prompted
```

### 5. Set your bot token as a secret
```bash
firebase functions:secrets:set TELEGRAM_BOT_TOKEN
# paste your bot token when prompted
```

### 6. Deploy
```bash
cd functions
npm install
cd ..
firebase deploy --only functions
```

After deploy, Firebase will print a URL for `telegramWebhook`, e.g.:
```
https://us-central1-yourproject.cloudfunctions.net/telegramWebhook
```

### 7. Point Telegram at your webhook
Run this once (replace `<TOKEN>` and `<URL>`):
```bash
curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=<URL>"
```
You should get `{"ok":true,"result":true,...}` back.

### 8. Test it
Open Telegram, find your bot, send `/start`. You should get the welcome
message. Then try:
```
/alert BTC above 70000
/myalerts
/delete <id>
```

## Adding more coins
Edit `functions/prices.js` and add to `SYMBOL_TO_ID`, using the coin's
CoinGecko ID (find it on coingecko.com — it's in the coin's URL).

## Free tier limit
Free users get 3 active alerts (`FREE_TIER_ALERT_LIMIT` in `index.js`).
To manually mark someone as paid (until you wire up real billing):
```
Firestore console → telegram_users/{chatId} → set isPaid: true
```

## Costs to expect
- Firestore: free tier covers this easily at small scale
- Cloud Functions: the scheduled check running every minute (~43,200
  invocations/month) is well within Firebase's free Blaze allowance for
  a small user base
- CoinGecko free API: rate-limited but sufficient for a 1-minute check
  interval with a handful of coins

## Next steps (once this works)
- Add percentage-change alerts (not just absolute price)
- Add a simple web dashboard (React) once you have real users asking for one

## Setting up `/upgrade` (Paystack payments)
1. Create a Paystack account at https://dashboard.paystack.com/#/signup and
   complete their verification (bank details, etc.) — payouts go straight
   to you, Firebase/this bot never touch the money.
2. From your Paystack dashboard, get your **secret key** (Settings → API
   Keys & Webhooks). Use the **test** key first to try it end-to-end
   before going live.
3. Set it as a Firebase secret:
   ```bash
   firebase functions:secrets:set PAYSTACK_SECRET_KEY
   ```
4. In your Paystack dashboard (Settings → API Keys & Webhooks), set the
   webhook URL to your deployed `paystackWebhook` function, e.g.:
   ```
   https://us-central1-e-trading-f5bec.cloudfunctions.net/paystackWebhook
   ```
5. Deploy:
   ```bash
   firebase deploy --only functions
   ```
6. Test with `/upgrade` in Telegram, pay with a
   [Paystack test card](https://paystack.com/docs/payments/test-payments/),
   and confirm you get the "Payment received" message and `/alert` no
   longer caps at 3.
7. Once confirmed working, swap in your **live** secret key
   (`firebase functions:secrets:set PAYSTACK_SECRET_KEY` again) and update
   the webhook URL/key to live mode in Paystack's dashboard.

The price is set by `UPGRADE_AMOUNT_NGN` in `functions/paystack.js`
(currently ₦2,000) — change it there.

