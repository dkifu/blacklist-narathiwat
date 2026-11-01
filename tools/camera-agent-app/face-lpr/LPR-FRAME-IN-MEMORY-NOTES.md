# Stage 20.6.2 — RTSP playback frame diagnostic (manual pilot only)

- Creates **no NVR configuration changes**, no Agent process integration, and no server upload.
- Manual command: `node face-lpr\lpr-playback-frame-smoke.cjs --manual-lpr-frame-probe`
- Local target `yakang-nvr-01`, camera 6; NVR-local time assumed `2026-10-31 12:34:10` through `12:34:20`.
- Works on the **same TCP connection** for RTSP Digest, DESCRIBE, SETUP, PLAY, TEARDOWN, using RTP over TCP channel 0.
- Captures at most 6.5 seconds, 1,800 RTP packets, and 5 MiB raw H264 in memory. Requires SPS, PPS, IDR; FFmpeg decodes to one in-memory JPEG; no disk files are saved.
- Real test output contains only protocol statuses, counts and validity. Password is entered invisibly; credentials are not placed in the command or FFmpeg arguments.
- If the NVR sends playback but no keyframe within the capture, the result is `NO_DECODABLE_KEYFRAME_IN_CAPTURE` rather than a false PASS. This test does **not** verify that an LPR plate was recognized, that a vehicle matches a face, or timestamps of individual frames.
- All new modules are isolated under `face-lpr/`; do not import them into `main.cjs` yet. Agent and NVR config remain disabled, no update published.
- Offline test: `node face-lpr\verify-lpr-playback-frame-probe.cjs` (synthetic H264 only; loopback RTSP mock, no real NVR).
