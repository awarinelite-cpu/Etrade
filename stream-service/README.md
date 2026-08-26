# Binance real-time stream service

Replaces once-a-minute polling with a persistent Binance WebSocket for
crypto price alerts. Metals (GOLD/SILVER/PALLADIUM) are **not** covered
here — there's no free real-time feed for them — they stay on the
existing `checkPrices` scheduled Cloud Function.

This is a **Cloud Run service**, not a Cloud Function, because it needs
to hold a long-lived WebSocket connection rather than run per-request.

## One-time setup

**1. Grant the Cloud Run service account access to Firestore and the bot
token secret.** Cloud Run uses the default compute service account
unless you specify otherwise:

```bash
PROJECT_ID=e-trading-f5bec
PROJECT_NUMBER=$(gcloud projects describe $PROJECT_ID --format='value(projectNumber)')
SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"

gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:${SA}" \
  --role="roles/datastore.user"

gcloud secrets add-iam-policy-binding TELEGRAM_BOT_TOKEN \
  --member="serviceAccount:${SA}" \
  --role="roles/secretmanager.secretAccessor"
```

(If `TELEGRAM_BOT_TOKEN` isn't in Secret Manager under that exact name,
run `gcloud secrets list` to find it — it's whatever Firebase created
when you ran `firebase functions:secrets:set TELEGRAM_BOT_TOKEN`.)

## Deploy

From the repo root in Cloud Shell:

```bash
cd stream-service

gcloud run deploy etrade-binance-stream \
  --source . \
  --region us-central1 \
  --no-allow-unauthenticated \
  --min-instances 1 \
  --max-instances 1 \
  --no-cpu-throttling \
  --memory 256Mi \
  --set-secrets TELEGRAM_BOT_TOKEN=TELEGRAM_BOT_TOKEN:latest
```

Key flags and why:

- `--min-instances 1` — keeps one instance always running so the
  WebSocket connection doesn't drop when traffic is idle (Cloud Run
  normally scales to zero).
- `--max-instances 1` — this service holds in-memory state
  (`activeAlerts`, `latestPrice`); running two instances would mean two
  independent Binance connections both trying to fire the same alerts.
  One instance is correct here, not a limitation to fix later.
- `--no-cpu-throttling` — without this, Cloud Run throttles CPU to
  near-zero between HTTP requests, which would stall the WebSocket
  message loop since this service isn't request-driven.
- `--no-allow-unauthenticated` — nothing needs to call this service's
  HTTP endpoints from outside; `/health` and `/status` are for your own
  `curl`/monitoring use via `gcloud run services proxy` or an
  authenticated request.

## Verify it's working

```bash
# Get the service URL
gcloud run services describe etrade-binance-stream --region us-central1 --format='value(status.url)'

# Proxy it locally (handles auth for you)
gcloud run services proxy etrade-binance-stream --region us-central1
# then in another Cloud Shell tab:
curl localhost:8080/status
```

`/status` shows the live price map, how many alerts are currently being
watched, and when each coin was last checked — if `latestPrice` is
populating and `activeAlertCount` matches what you'd expect, it's
working.

Check logs with:

```bash
gcloud run services logs read etrade-binance-stream --region us-central1 --limit 50
```

## Rollback / disable

Since `functions/checkPrices` is untouched, you can always stop this
service without losing alert coverage — crypto just goes back to
1-minute polling:

```bash
gcloud run services update-traffic etrade-binance-stream --region us-central1 --to-revisions=none
```

or delete it entirely:

```bash
gcloud run services delete etrade-binance-stream --region us-central1
```
