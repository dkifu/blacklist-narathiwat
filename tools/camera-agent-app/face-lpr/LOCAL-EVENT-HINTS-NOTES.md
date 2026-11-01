# Stage 22.3 — Local-only deterministic Face/LPR hints

## Scope
- Adds `local-event-hints.cjs` and an offline verifier. **Does not modify** `main.cjs`, `package.json`, heartbeat, Electron, server, NVR or database.
- Re-evaluates an **historical** record using `buildHistoricalAlertDraft`; does not accept a caller-forged qualified flag or arbitrary ready-to-send draft.
- Generates deterministic SHA-256 hints for the candidate and each of its planned LPR slots; never generates or asserts a real server event ID, image object key or sent/received status.
- Returns neither personal name nor image bytes/paths in the hints. The hint hashes *do* derive from candidate metadata (including name), so treat hints as sensitive internal data, **not anonymous identifiers**.
- Does not read, write, persist or transmit anything. The original pilot config remains disabled.

## Important caveats
- **Local hints are not authoritative dedupe keys**. Two legitimate NVR detections can have identical metadata (same second, channel, person and score). Do not enforce a unique database constraint based on these hints alone.
- The server must authenticate Agent devices separately from heartbeat, authorize center/NVR, validate source event provenance and time, and assign server-managed event IDs. Use server-side idempotency and audit trails after a stable NVR event ID or another trusted disambiguator is established.
- `NVR_LOCAL_WALL_CLOCK_UNVERIFIED_OFFSET` must not be reinterpreted as UTC. Cross-NVR capture stays blocked until clock synchronization is reviewed.
- LPR candidates are contextual images, **not proof of a person's vehicle ownership or association**. No identity confirmation or alert delivery occurs here.
- We do not yet have durable queues, image storage, upload transport, leader election/failover, server/RLS changes, UI, or multi-frame production capture.

## Verify
From `tools/camera-agent-app`:

```bat
node face-lpr\verify-local-event-hints.cjs
node face-lpr\verify-alert-draft.cjs
node --check main.cjs
```
