# Stage 15 — Manual FaceComparision stream probe

New files only. No changes to `main.cjs`, the Ping module, port 8765, heartbeat V2, auto updater, packaging configuration, server or database.

- `face-event-parser.cjs`: bounded incremental multipart parser. Parses multiline JSON across chunks. Ignores events other than `FaceComparision`; converts zero-based event `index` to one-based UI `channel`. It does **not** confirm whether an event matches a High Risk watchlist.
- `face-event-stream.cjs`: HTTP Digest stream reader for an authorized private IPv4 NVR. Reuses the Digest helpers from `nvr-client.cjs`, rejects redirects/other hosts and supports an AbortSignal. No reconnection, queue, deduplication, server upload or background service yet.
- `verify-events.cjs`: local mock test. No requests to real NVR.
- `face-event-smoke.cjs`: optional 30-second manual test, explicitly gated by `--manual-live-test`. Reads host and camera mapping from existing disabled pilot config but **does not enable** it. No personal data is printed; no image download or upload.

## Offline test (do this first)

From `tools/camera-agent-app` in Windows CMD:

```
node face-lpr\verify-events.cjs
node face-lpr\verify-nvr.cjs
node face-lpr\verify.cjs
node --check main.cjs
git status --short
```

## Later, after offline test has passed and when connected to the camera LAN

```
node face-lpr\face-event-smoke.cjs --manual-live-test
```

Expected if idle: `STREAM: OPEN`, `HEARTBEAT: RECEIVED`, `FACE_EVENTS: 0`. If no face passes the camera during the window, zero events is normal. A streamed event is not automatically a High Risk match. For positive High Risk filtering, inspect a *consented, sanitized* event schema separately, without disclosing personal images or identifiers.

**Security**: Use only on an authorized internal network. Digest authentication over HTTP is not transport encryption. The pilot uses an admin account only for testing; use an appropriately restricted account for production. No credentials are written to config, logs or disk.
