# Stage 18 — historical NVR verification (manual, read only)

- Run **only** from an authorized workstation with access to `172.17.2.23`:
  `node face-lpr\\historical-face-smoke.cjs --manual-historical-test`
- `pilot.config.json` remains disabled. The script activates only an **in-memory copy** for testing `evaluateHistoricalFaceRecord`; it does not start Electron Agent.
- CGI: `mediaFileFind.cgi` `factory.create` → `findFile` → `findNextFile` → `close` → `destroy` (cleanup attempted even on failures).
- HTTP Digest and NVR session cookies are held **in RAM only**; request is constrained to configured private IPv4 NVR, not a URL supplied by the NVR. HTTP on an authorized trusted LAN is not encrypted.
- Searches a single historical event (31 Oct 2026, 12:34:15, NVR UI channel 9) and prints **only safe test metadata**, never face, ID, name, raw response, picture paths or tokens.
- Every query is read-only, but `factory.create` allocates a *temporary search session* which is explicitly closed/destroyed; no NVR camera/storage settings are modified.
- Does not download images, notify any person, send events to server, persist duplicates, change Ping/Heartbeat/updates, or build/release Agent.
- `HIGH_RISK_ELIGIBLE=true` is **not** verification of identity, not proof of image availability, and is **not an instruction to alert**.
- If `CLEANUP_UNCONFIRMED` occurs, do not repeat scans blindly; inspect separately.
- Offline: `node face-lpr\\verify-historical.cjs` with a mock HTTP server and synthetic records (no real NVR).
