# Face + LPR pilot — configuration skeleton only

This directory is an **offline foundation** for adding optional Face/LPR support to CCTV Ping Agent. It is not connected to `main.cjs` and makes no network requests. It does not enable events or send any data.

## Safety / compatibility

- `enabled: false` and the pilot NVR `enabled: false` by default.
- Does not modify Ping, Heartbeat V2, local port 8765, auto-updater, installer, or server APIs.
- Existing Agents (including v1.0.11) continue working unchanged.
- Pilot data uses NVR `172.17.2.23`, Face CAM 9, and LPR CAM 6. All camera `channel` numbers are **1-based UI channel numbers**; translate to 0-based event indices at integration boundaries.
- No passwords, tokens or private keys in JSON. Credentials require separate encrypted handling after review.
- NVR titles should be resolved from `ChannelTitle` at runtime, not hardcoded.
- `mappings` can associate a face camera with multiple LPR cameras, even if those cameras are on different NVRs. Mapping is only time-contextual; it never proves vehicle ownership or identity.
- For actual rollout: the central server must select exactly one capable live Agent per NVR (with fenced lease), deduplicate across agents, and avoid assigning new commands to old Agents. This prototype does not implement those features.
- Additional future work: NVR Auth, event ingestion, secure outbound channel, durable queue, least-privilege image storage, authorization, data-retention, and staging-only update publication.

## Offline test

From `tools/camera-agent-app`:

```cmd
node face-lpr\verify.cjs
node --check main.cjs
git status --short
```

No installed Agent or NVR is contacted.
