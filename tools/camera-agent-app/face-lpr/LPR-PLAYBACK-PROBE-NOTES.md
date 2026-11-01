# Stage 20.3 — Dahua LPR RTSP Playback Probe

Purpose: identify whether the NVR offers playback SDP for LPR camera 6 during
2026-10-31 12:34:10–12:34:20 (assumed NVR-local timestamp).

This is a **manual, read-only RTSP DESCRIBE** capability test, not recording proof.
RTSP SDP availability does **not** guarantee media exists for the full interval.
Different Dahua firmware revisions may expect different RTSP playback URLs or
time-zone conventions. A 404/454/etc. is inconclusive, not a reason to modify the NVR.

- Uses standard Dahua `/cam/playback?channel=6&starttime=...&endtime=...`.
- Uses RTSP Digest authorization (one challenge and one authenticated retry).
- Prompts for password without echo; password is never passed to a subprocess,
  included in the URL, written to disk, or printed.
- Sends DESCRIBE only; no SETUP, PLAY, image, recording, server upload, or state change.
- No changes to `main.cjs`, agent heartbeat, update channel, or active config.

## Tests

From `tools/camera-agent-app`:

```
node face-lpr\verify-lpr-playback-probe.cjs
node --check main.cjs
```

Only on a workstation with direct NVR access, after mock test passes:

```
node face-lpr\lpr-playback-smoke.cjs --manual-playback-probe
```

If `RTSP_DESCRIBE_STATUS: 200` and `SDP_VIDEO_PRESENT: true`, the RTSP
endpoint provides a video SDP; proceed to a **separate, bounded** media test.
If not, diagnose URL, recording availability and NVR clock before proceeding.
