# Stage 23.18 — Offline signed Agent event envelope

This bundle adds `face-lpr/agent-event-envelope.cjs` (a signing-envelope builder) and `face-lpr/verify-agent-event-envelope.mjs` (offline tests). It DOES NOT change `main.cjs`, any deployed Agent, auto-update, or the Server.

Expected repo precondition: `face-lpr/server/agent-face-lpr/event-signature-core.ts` from Stage 23.16 already exists. The ZIP does not include or overwrite this existing file.

Windows CMD from `tools\camera-agent-app`:

```bat
tar -xf "%USERPROFILE%\Downloads\face-lpr-stage23-18-agent-signer-offline.zip"
node --experimental-strip-types face-lpr\verify-agent-event-envelope.mjs
git status --short
```

Expected test: `FACE_LPR_AGENT_EVENT_ENVELOPE_OFFLINE_TEST: PASS` and `SIGNED_PAYLOAD_MATCHES_SERVER_VERIFIER: YES`. Node experimental TypeScript warnings do not require changing `package.json`.

The module accepts a trusted `signBytes` callback; when integrated it must be called only from Electron main and decrypt `privateKeyProtected` using `safeStorage` inside that callback. Never pass the private key to renderer/web/client code or logs.

Important: `sourceEventKey` must originate from a stable identifier for the same NVR event across Agent instances; the test's placeholder is not suitable for production. The payload explicitly has `vehiclePersonAssociationConfirmed: false`.

Security blocker before live pilot: the current Stage 23.16 challenge endpoint issues challenges based only on a device ID when its permission is enabled; it lacks a signature on the *challenge request*. Before enabling any Agent's Face/LPR permission, implement authenticated/rate-limited challenge issuance to avoid nuisance-request denial of service. Server event-ingestion remains disabled.
