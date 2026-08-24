# Signal — Landing Page + Dashboard

A static site for the crypto price alert Telegram bot. No build step —
plain HTML/CSS/JS, deploys to Vercel as-is.

## Structure

```
index.html          Landing page (marketing, how it works, pricing)
dashboard.html       Read-only alert dashboard
css/style.css         Shared design system (tokens, layout, components)
css/dashboard.css     Dashboard-specific styles
js/main.js            Landing page micro-interactions
js/firebase-config.js Firebase init (config is safe to expose - see note below)
js/dashboard.js        Dashboard data fetching + rendering
firestore.rules        Security rules - READ THIS before going live
```

## Deploy to Vercel

1. Push this folder to a GitHub repo (or a subfolder of one)
2. Go to vercel.com → New Project → import the repo
3. Framework preset: **Other** (no build step needed)
4. Root directory: point it at this folder if it's nested in a larger repo
5. Deploy

That's it — no environment variables needed, since the Firebase web config
is safe to commit (see below).

## Before going live: deploy the Firestore rules

The dashboard reads directly from Firestore using the Firebase client SDK,
with no login. That only stays safe because of `firestore.rules` in this
folder, which:
- Allows public **read** of `alerts` and `alert_history`
- Blocks all client **writes** — only your Cloud Functions (Admin SDK) can
  write, since Admin SDK calls bypass these rules entirely
- Blocks all read/write on `telegram_users`

Deploy these rules from the bot's Firebase project (the `Etrade` repo):
```bash
firebase deploy --only firestore:rules
```
(Copy `firestore.rules` into that project first, or point the Firebase CLI
at this file's location.)

**Without deploying these rules, do not launch the dashboard** — the
Firestore project defaults may be more permissive and could allow writes
from anyone.

## Why the Firebase config can be public

`firebaseConfig` in `js/firebase-config.js` is not a secret. It tells the
SDK which Firebase project to talk to — it doesn't grant any access by
itself. Actual access control lives entirely in `firestore.rules`. This is
standard for Firebase web apps; see Google's own docs on this if you want
to double check.

The one thing that must never end up in this static site: the Telegram bot
token. That stays in Cloud Functions secrets, in the `Etrade` repo, and
never touches client-side code.

## How the dashboard identifies a user (MVP approach)

There's no login. A user gets their Telegram `chatId` by sending `/myid` to
the bot, then pastes it into the dashboard. The dashboard queries Firestore
for alerts matching that `chatId`.

This is "unlisted ID" privacy, not authenticated privacy — treat it like a
private link, not a password. It's a reasonable MVP tradeoff given the data
involved is just alert configs (coin, price, condition), not funds or
personal info. If you want real auth later, swap this for Firebase Auth
(e.g. sign in with the same Telegram account via a proper OAuth-style
linking flow) — that's a bigger feature, not needed to ship this.

## Local preview

No build tooling required:
```bash
python3 -m http.server 8080
# then open http://localhost:8080/index.html
```

## Editing content

- Bot username: search `your_bot_username` in `index.html` and replace with
  your real bot's @handle
- Coins shown: edit the `.coin-grid` section in `index.html` to match
  whatever's in `functions/prices.js` in the bot repo
- Pricing: edit `.pricing-grid` in `index.html` directly — there's no CMS,
  it's just markup
