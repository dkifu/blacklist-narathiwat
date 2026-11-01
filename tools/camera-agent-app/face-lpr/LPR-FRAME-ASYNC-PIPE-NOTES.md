# Stage 20: FFmpeg async pipe for large RTSP captures

Real NVR pilot delivered 3,257,262 bytes H.264, RTP 2749 packets, no collector discards, SPS/PPS/IDR present, but the synchronous `spawnSync()` decoder reported `FFMPEG_SPAWN_ERROR`.

This patch adds a bounded, async FFmpeg runner using `spawn()` and pipes. On some platforms FFmpeg exits as soon as it has encoded its first JPEG, while Node is still writing megabytes of H.264; an `EPIPE` from stdin is not a decode failure if process exits successfully with a complete JPEG. It also first attempts a trimmed IDR GOP, then retries the original full capture. JPEG remains in memory and is never saved or uploaded by this probe. FFmpeg path remains `ffmpeg`, no credentials in arguments. Existing synchronous decoder and standalone agent remain untouched.

Manual workflow from `tools/camera-agent-app`:

1. `node face-lpr/verify-lpr-frame-async.cjs`
2. `node face-lpr/verify-lpr-frame-recovery.cjs`
3. `node face-lpr/verify-lpr-playback-frame-probe.cjs`
4. `node face-lpr/lpr-playback-frame-smoke.cjs --manual-lpr-frame-probe`

Do not commit or enable the Face/LPR pilot until the real NVR image test passes. The actual image must be visually checked before associating it with a face alert.
