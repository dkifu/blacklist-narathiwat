# Stage 21.4 — One manually authorized real planned LPR JPEG sample

The **existing pilot configuration remains disabled**. The new script reads a
historical FaceRecognition event from the known Narathiwat pilot NVR, checks
High Risk Person >=90, matches the original event time 2026-10-31 12:34:15,
constructs an in-memory temporary enabled *copy* of the configuration, and
executes **only job #0**: LPR channel 6, playback 12:34:10–12:34:13.

The retrieved image is verified **only in memory**. No image file is written,
no alert is sent, no server is contacted, and no Agent code is modified.
Image frame timestamp is UNKNOWN; it is only time-context imagery and does not
confirm ownership, identity, or even a distinct passing vehicle. The preview
and human verification workflow is later work. The short 3-second playback
window may lack a keyframe, in which case the test correctly fails.

Use CMD from tools/camera-agent-app:

```
node face-lpr\verify-lpr-planned-smoke.cjs
node face-lpr\lpr-planned-sample-smoke.cjs --manual-one-planned-sample
```

Never place NVR credentials in CLI args, a URL, source code, or chat messages.
The script prompts for a hidden password. No automatic retries, scheduling,
continuous polling, or production updates.
