# Stage 22.2 — Local-only Face/LPR alert metadata draft

## Scope
- New standalone Node.js CommonJS module. No `main.cjs`, package, heartbeat, database, storage, NVR, or server changes.
- Converts **internally re-evaluated historical High Risk** results into a *non-transmittable local draft*.
- Uses existing `lpr-capture-plan.cjs` to allocate one placeholder per planned LPR sample. Many cameras/NVRs supported.
- Does not fetch JPEGs, store images, connect to NVR, send requests, or start Electron.

## Important restrictions
- `LOCAL_DRAFT_NOT_SENT`: not a verified detection, identity, or authenticated server event.
- `personId` is empty, not substituted from any device/NVR internal UID.
- `timeBasis` is NVR-local wall time without a verified UTC offset; `actualFrameTime` remains `null`.
- LPR samples remain `NOT_CAPTURED` or `BLOCKED_PENDING_REVIEW`; no images or fake image links are attached.
- `vehiclePersonAssociationConfirmed` remains `false`; a temporal coincidence alone is not proof of identity or vehicle association.
- Host addresses, NVR image paths, login credentials, private keys, JPEG bytes and video are not copied into the draft.
- No persistent event ID, deduplication, upload authentication, delivery retry queue, RLS, RBAC, object storage, popup, or real alerts yet. The server must validate all fields independently.
- Later integration must implement authenticated, authorized, encrypted transport separated from Heartbeat V2; verified private image storage; deduplication and agent-level leader/failover logic. Legacy Agents must continue unaffected.

## Offline test
Run from `tools/camera-agent-app`:

```bat
node face-lpr\verify-alert-draft.cjs
node --check main.cjs
```

The test locally clones and enables a **synthetic test config only**. On-disk pilot stays disabled.
