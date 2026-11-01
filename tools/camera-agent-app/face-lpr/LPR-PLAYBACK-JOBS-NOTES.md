# Stage 21.3 — Offline capture-job adapter (manual pilot only)

- Consumes the **existing**, validated Stage 21 `buildLprCapturePlans` result, without changing `pilot.config.json`, `main.cjs`, NVR/Agent or the existing Stage 20 decoder.
- Generates five requested LPR playback start times for the Yakang test: 12:34:10, :11, :12, :13 and :14 (NVR-local clock). Each playback request is bounded to **at most three seconds**, and never extends beyond the configured half-open 12:34:10–12:34:15 interval.
- Samples are **approximate requested times**. An extracted first decodable H.264 frame is **not** proof of an exact time, a vehicle/person match, or of five distinct vehicles. This stage intentionally records `actualFrameTime: UNKNOWN`. Different requests may return the same frame. Human review is mandatory.
- Prevents use when disabled, when high-risk evidence is unqualified, with public NVR addresses, or when cross-NVR clock synchronization has not been verified. For cross-NVR mappings, plans are listed but execution is blocked until an explicit clock policy is implemented.
- `captureOnePlannedSample` requires `manualReadOnly:true`, in-memory credentials, an explicit job index and an authorized (normally enabled) validated config. It delegates to the Stage 20 same-TCP Digest RTSP collector and asynchronous FFmpeg decoder. Returns an in-memory JPEG; **no** file, alert, network upload or persistent data is written by this adapter.
- The real pilot configuration **remains disabled**. Current offline tests use a temporary in-memory enabled copy and a mock RTSP collector with a fully synthetic H.264 fixture. FFmpeg is executed locally on the synthetic fixture; **no NVR requests** are sent.
- Real NVR manual smoke command / user-visible frame review are **not** part of this patch and must be separately implemented and tested. Do not assume 3-second windows always contain an IDR keyframe; failures remain possible. Do not push production Agent updates.

Run from `tools/camera-agent-app`:

```bat
node face-lpr\verify-lpr-playback-jobs.cjs
node face-lpr\verify-lpr-capture-plan.cjs
node --check main.cjs
```
