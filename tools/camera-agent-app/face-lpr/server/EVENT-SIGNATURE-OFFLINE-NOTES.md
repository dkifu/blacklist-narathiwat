# Stage 23.11 — Face/LPR event signing contract (offline only)

This package **adds files only**; it does not patch the live deployed `agent-face-lpr/index.ts`.

## Contract

The Ed25519 message is UTF-8, LF-separated:

```
CCTV-AGENT-FACE-LPR-V1
challengeId
deviceId
nonce
agentVersion
payloadSha256Hex
```

- `payloadSha256Hex` is SHA-256 of the **exact raw canonical JSON UTF-8 bytes** decoded from `payloadBase64`. It must be computed on the server, never trusted from a client-supplied field.
- `payloadBase64` holds metadata **only**; maximum 16 KiB raw decoded bytes. JPEG bytes and RTSP video are not supported by this protocol.
- A strict JSON round-trip (`JSON.stringify(JSON.parse(text)) === text`) rejects noncanonical formats and duplicate object keys. Do not parse/reformat and then hash a different byte string.
- Public key is the existing registered PEM SPKI Ed25519 key. Client must use the existing Agent-protected private key; never include the key in payloads/logs.
- A valid signature is **necessary but not sufficient**: a future API must verify `client_devices` is active/linked, feature permission is enabled, device/center scope, challenge TTL/device ownership, **atomic consumption**, strict event schema, server-side dedupe, and authorization for images.
- The deployed Stage 23 challenge-only route still returns `503` for submit/event/upload. No operational Event API, media upload or notifications are enabled by this package.
- `agent-heartbeat`, `main.cjs`, `package.json`, PostgreSQL schema and live Edge Functions are untouched.

## Offline verification

From `tools/camera-agent-app` on Windows:

```
node --experimental-strip-types face-lpr\server\verify-face-lpr-signature.mjs
```

Uses a generated disposable Ed25519 test keypair; no actual Agent private key, no internet access, no NVR calls, no server writes.
