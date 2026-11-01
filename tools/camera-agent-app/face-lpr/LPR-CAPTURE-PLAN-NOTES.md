# Stage 21.1 — Face event → LPR capture plan (offline only)

- Requires a **qualified high-risk assessment** from `high-risk-filter.cjs` with a **present, valid historical event timestamp**; the current live event evaluator leaves time `null` and is rejected until its timestamp is independently established.
- Uses existing `pilot.config.json` only: a mapping from Face CAM9 to LPR CAM6 with `offsetSeconds=-5`, `windowSeconds=5`, `sampleCount=5` produces a **half-open** 12:34:10–12:34:15 NVR-local window, with proposed samples at 10/11/12/13/14 seconds. This is **not** a -5s to +5s window. Changes to timing require a deliberate config update in a later reviewed step.
- Multi-camera and cross-NVR capture plans are supported without hardcoded counts; **cross-NVR targets are blocked for automated capture** until clocks/timezone synchronization and offsets are verified. All times are *unverified NVR-local wall clock*, NOT UTC or proof of physical simultaneity.
- Sample timestamps are **requests / suggested points**, not proof actual LPR frames exist at those precise times, and not evidence a specific vehicle belongs to a person. A human must review/select images.
- The returned data includes only mapping ID, camera IDs/channels, wall-clock window, sample timestamps and status. No biometric person name, ID, image paths, passwords, network requests, notifications, saving or Agent integration.
- The pilot stays `enabled:false`; the offline test uses an in-memory enabled copy. `main.cjs`, Ping, Heartbeat, updates, auto-install and older Agents are untouched.

From `tools/camera-agent-app` run `node face-lpr\verify-lpr-capture-plan.cjs`. No NVR login needed.
