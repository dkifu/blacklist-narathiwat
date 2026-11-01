# Stage 23.19 — Signed Face/LPR challenge requests (fail-closed)

Changes only the OPTIONAL Face/LPR challenge path. Existing CCTV Ping Agent 1.0.11,
heartbeat V2 and NVR settings are untouched. Event ingestion stays disabled.

## What this fixes

- Requires Ed25519 signature signed using the enrolled Agent's existing identity key.
- Binds deviceId, agentVersion, issuedAt UTC timestamp, and random requestNonce.
- Rejects stale/invalid requests (90-second server clock window).
- SQL RPC checks current Agent permission and prevents replay by unique (deviceId,requestNonce)
  atomically alongside challenge issuance and a maximum of 3 pending challenges.
- The old unsigned `{action:'challenge', deviceId}` path returns HTTP 400 after patch.

## Windows offline test

Extract into camera-agent-app root, then:

    node --experimental-strip-types face-lpr\verify-challenge-auth.mjs
    node --check main.cjs
    git diff --check

The offline check does not test the new PostgreSQL RPC. DO NOT enable Agent permissions
until the SQL, negative real-server API tests, and reviewed Electron main signing
callback are integrated and tested. Do not switch EVENT_INGESTION_ENABLED.

## Database and deployment (later, separately)

1. Run `face-lpr/server/sql/23_19_signed_challenge_rpc.sql` via Supabase Studio,
   review output and ensure its service-only execute grants.
2. Send only `face-lpr/server/agent-face-lpr/index.ts` and `challenge-auth-core.ts`
   to the Ubuntu staging folder.
3. Verify SHA256 against local before backing up and replacing the Face/LPR function files.
4. Check unsigned challenge -> 400, fake signed Device ID -> 403, event -> 503.
5. No Supabase container restart, no Agent installer/manifest update.

## Caveats

Database nonce records are retained. Add restricted periodic cleanup after rollout
(before size grows substantially); 90-second issuedAt window ensures old requests
cannot be replayed after cleanup. This stage does not prove full positive end-to-end
integration or Face/LPR correctness and it does not enable failover.
