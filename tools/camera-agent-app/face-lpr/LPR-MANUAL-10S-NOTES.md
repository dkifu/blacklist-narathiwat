# Stage 21.4.8 — 10-second read-only single-sample RTSP diagnostic

This is a strictly manual pilot-only diagnostic. The existing `pilot.config.json` is **not modified** and stays disabled, and `main.cjs` is untouched.

The original 5-image capture plan is kept intact: Face CAM9 at 2026-10-31 12:34:15; planned first sample at 12:34:10. The test temporarily asks NVR CAM6 for **12:34:10 through 12:34:20** (10 seconds) instead of the original 3-second playback URL interval. It obtains **at most one JPEG**, while taking **up to 8 seconds of RTSP media** within existing hard packet/byte/time limits. This includes up to five seconds *after* the face event. The actual JPEG frame timestamp remains **UNKNOWN**, and this is **time-context video only**, not proof of vehicle-person association.

Only media data in process memory and FFmpeg stdin/stdout pipes are used. The script does **not** save a clip or JPEG locally or on a server and does **not** upload, dispatch alerts, connect Agent main, or run in the background. RTSP is closed via TEARDOWN; JPEG bytes are dropped when the test process ends.

Status-only RTSP diagnostics are displayed after a playback attempt, whether it succeeded or failed, to distinguish a 401 or missing SDP from a 200 with no media. Do not share passwords or full private paths. No automatic credential retries are added.

In CMD from camera-agent-app:

```
node face-lpr\verify-lpr-manual-window.cjs
node face-lpr\verify-lpr-playback-jobs.cjs
node face-lpr\verify-lpr-planned-smoke.cjs
node face-lpr\lpr-planned-sample-smoke.cjs --manual-one-planned-sample
```
