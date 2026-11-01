# Stage 20: bounded playback JPEG recovery (pilot only)

The real NVR delivered RTSP 200, H264 and 1,800 RTP packets but the one-frame FFmpeg decode failed.
This patch updates only `lpr-playback-frame-decode.cjs` and the manual-only `lpr-playback-frame-smoke.cjs`.
It gives FFmpeg a longer (but bounded) H264 sample, attempts to decode an I frame,
then retries with SPS/PPS followed by the earliest collected IDR. The test prints
only packet counts and safe diagnostic classifications; no raw media, credentials,
SDP or URIs are logged. A JPEG PASS still needs manual visual review of the LPR image
before using any image as evidence.

Limits for manual test: max 8 seconds or 3,000 packets or 7 MiB of H264, whichever
is reached first. The RTSP session is torn down; media stays in RAM. No server upload.

Commands from `tools/camera-agent-app`:

- `node face-lpr/verify-lpr-frame-recovery.cjs`
- `node face-lpr/verify-lpr-playback-frame-probe.cjs`
- `node face-lpr/lpr-playback-frame-smoke.cjs --manual-lpr-frame-probe`

Do not commit or enable the face/lpr pilot until the real NVR test passes.
