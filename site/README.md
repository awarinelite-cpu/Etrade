# Signal — web dashboard

React + Vite + Tailwind app. Landing page at `/`, live dashboard at `/dashboard`.

## Local dev
```bash
cd site
npm install
npm run dev
```

## How it talks to the backend
- **Reads** (alerts, alert history) go straight to Firestore via `onSnapshot` —
  real-time, no polling, no backend round-trip. This works because
  `firestore.rules` (repo root) allows public reads on `alerts`/`alert_history`
  scoped by chatId (see that file for the privacy model).
- **Writes** (create/edit/delete alert) never touch Firestore directly from
  the browser. They call the `createAlertApi` / `updateAlertApi` /
  `deleteAlertApi` Cloud Functions (see `functions/alertsCore.js`), which run
  the same validation and free-tier checks as the Telegram bot before writing
  with the Admin SDK.
- **Live prices** are fetched client-side directly from CoinGecko and
  gold-api.com (see `src/lib/prices.js`) — same free, keyless APIs the
  backend uses, kept in sync manually with `functions/prices.js` and
  `functions/metals.js`.

## Deploy
Deployed by Vercel per the repo-root `vercel.json` (builds this folder,
serves `site/dist`). Push to `main` and Vercel picks it up automatically —
no manual deploy step needed for the web app (unlike the bot, which needs
`firebase deploy --only functions`).
