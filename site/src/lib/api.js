// Calls the Cloud Functions HTTP API for anything that writes to Firestore.
// The legacy-style URL works for 2nd-gen functions too (Google keeps it as
// a stable alias to the underlying Cloud Run service), so this doesn't need
// to know the per-deploy Cloud Run hostname.
const FUNCTIONS_BASE = "https://us-central1-e-trading-f5bec.cloudfunctions.net";

async function callApi(name, payload) {
  const res = await fetch(`${FUNCTIONS_BASE}/${name}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok || !data.ok) {
    throw new Error(data.error || "Something went wrong. Try again.");
  }
  return data;
}

export function createAlert(payload) {
  return callApi("createAlertApi", payload);
}

export function updateAlert(payload) {
  return callApi("updateAlertApi", payload);
}

export function deleteAlert(payload) {
  return callApi("deleteAlertApi", payload);
}
