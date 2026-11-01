# Stage 23.16 — atomic Face/LPR event backend (fail-closed pilot)

This patch is intended only for branch `feature/face-lpr-pilot`. It does not alter `main.cjs`, the 15 existing Ping Agents, the v2 heartbeat, the updater, or NVR configuration. It contains NO RTSP credentials.

## Included
- `face-lpr/server/sql/23_16_atomic_event_rpc.sql`: two service-role-only SECURITY DEFINER RPCs. Atomic per-device challenge issuance (max 3 pending) and atomic verified-event consume/insert with unique source key and active NVR/camera/mapping/primary Agent checks. Must be run by authorized Supabase Studio administrator.
- `face-lpr/server/agent-face-lpr/index.ts`: new API router with Ed25519 verification and RPC wiring; **event ingestion is hard-coded OFF** (`EVENT_INGESTION_ENABLED = false`). `action: event/submit/upload` returns HTTP 503. Adds `X-Face-LPR-Stage: 23.16` HTTP header to identify the new version.
- `challenge-core.ts`, `event-signature-core.ts`: existing offline-tested modules.
- `verify-face-lpr-signature.mjs`, `verify-stage23-16-safe.cjs`: tests.

## Quick use
From the existing Windows repository folder `tools/camera-agent-app`:

```
tar -xf "%USERPROFILE%\Downloads\face-lpr-stage23-16-atomic-backend.zip"
node --experimental-strip-types face-lpr\server\verify-face-lpr-signature.mjs
node face-lpr\server\verify-stage23-16-safe.cjs
node --check main.cjs
git diff --check
git status --short
```

**Do not install on Ubuntu yet.** First run the SQL using Supabase Studio, confirm `service_role_execute=true` and the public roles false for BOTH functions, and check challenge/event counts. Then stage the `.ts` files over SCP and verify hashes. Only after the SQL and review should the old `agent-face-lpr/index.ts` be safely backed up and replaced. Do not change any existing `agent-heartbeat` file or restart Supabase containers.

## Envelope (future use only; NOT enabled yet)
Top-level event action: `action`, `deviceId`, `challengeId`, `nonce`, `agentVersion`, `payloadBase64`, `signatureBase64`.
The payload is a *canonical JSON object* base64-encoded, with exactly:
`schemaVersion:1`, `eventKind:'face_lpr_high_risk'`, `centerId` (numeric center PK), `nvrId`, `faceCameraId`, `sourceEventKey` (64 lowercase hex), `eventTimeLocal` (`YYYY-MM-DD HH:mm:ss`, NVR local clock, no implied UTC), `similarityScore` (90..100, up to 2 decimals), and `vehiclePersonAssociationConfirmed:false`.
Ed25519 signing message is six newline-separated UTF-8 fields:
```
CCTV-AGENT-FACE-LPR-V1
challengeId
deviceId
nonce
agentVersion
sha256_hex_of_exact_canonical_payload_json_bytes
```
**No vehicle-person relationship is asserted or stored.** This stage does not upload photos or clips. Event data is for staff review only and does not prove identity.

## Safety limitations / not ready to turn on
- This bundle has been static-checked and event signature primitives tested offline; it has **NOT** been tested against this specific live PostgreSQL schema or deployed Edge runtime. Do not enable ingestion after just unzipping.
- Device authentication occurs at the Edge function; the service-role-only RPC must not be exposed to untrusted clients with a service key.
- `sourceEventKey` must be derived from an NVR-native **stable event identifier** (and camera identifier if event IDs are scoped per camera), **never** from Agent ID, request time, random UUID, or an approximate frame timestamp. Otherwise cross-Agent dedup is not guaranteed. Confirm stable NVR event ID before enabling.
- Agent must generate signatures using its protected existing key without logging key/password, and correctly encode payload. Not implemented in v1.0.11.
- Active assignments/mappings/NVR/cameras/permissions remain false and the server flag remains false. No automatic failover; this RPC accepts PRIMARY priority 1 only.
- Historical NVR timestamps are not verified against an absolute UTC clock; staff review required. Fine-grained authorization, rate limits at ingress, audit and retention still required before production rollout.
- With this SQL RPC, no existing Ping/Heartbeat schema needs modification; a later phase can handle viewer access with dedicated RLS and audited operations.
