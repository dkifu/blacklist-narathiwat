# Stage 23.10.6 — Face/LPR challenge-only Edge Function

Scope: an *independent* Supabase Edge Function `agent-face-lpr`, with action `challenge` only. No event submission, no media uploads, no heartbeat changes, and no Agent auto-update.

Existing schema preconditions:
- `public.client_devices` has id, status, center_id, linked_at
- `public.face_lpr_agent_permissions` has device_id, enabled, enabled_by, enabled_at
- `public.face_lpr_event_challenges` has id, device_id, nonce, created_at, expires_at, consumed_at

Conditions for issuing a challenge: device status is `active`, device is linked to a center, and its Face/LPR permission is *explicitly* enabled with enablement audit fields. All 15 existing v1.0.11 Agents remain disabled (0 enabled permissions).

Safety limitations:
- Event/submit/upload actions **always return HTTP 503** and do not write to the event database.
- The challenge action is *not* proof of event authenticity. A future submission endpoint must verify Ed25519 over the payload hash and consume the challenge atomically; do not use returned challenge by itself as authorization.
- A maximum 3 pending, unconsumed, unexpired challenges per device is checked in application code. For production load, add a database-enforced atomic rate limiter plus perimeter abuse protections and stale row cleanup; this limit is not fully race-proof yet.
- A fresh challenge can be requested with only device ID if a device has been explicitly enabled; account for denial-of-service and rate-limit at ingress before enabling devices.
- This feature is fail-closed by default, but running it in an internet-facing gateway still deserves a controlled deployment.

Offline test (Node 22+):
```
node --experimental-strip-types tests/verify-face-lpr-challenge.mjs
```

Do not overwrite existing functions. Place `agent-face-lpr/` as a new directory under `/home/melonman/supabase-server/volumes/functions/` *only after* reviewing the files and confirming the deploy plan. Router uses `path_parts[1]` and automatically resolves function folders; no change to `main/index.ts` is required. Existing `agent-heartbeat` must remain unchanged.
