# Stage 20.5: bounded LPR recorded video probe

Pilot only. Adds four files under `face-lpr/`, no changes to `main.cjs` or any existing Agent code. Config must remain disabled.

Runs RTSP DESCRIBE (same-socket Digest), SETUP over interleaved TCP, PLAY, then TEARDOWN. Captures at most 5 valid video RTP packets, with a maximum 3 s listening window and 8 s total timeout. Media stays in volatile buffers, is never decoded to faces, saved, logged, uploaded or returned. The script reports only status codes, declared video codec and aggregate packet counts. The password is entered interactively, not in a process command line.

Private NVR target and single approved LPR channel 6 at Yakang; playback window is 2026-10-31 12:34:10–12:34:20 *assumed local NVR clock*. Successful DESCRIBE does not prove that frames exist; only video RTP packets after PLAY are evidence of delivered media. TEARDOWN is sent if a session has been established. The camera/NVR configuration is unchanged.

**First run:** `node face-lpr\\verify-lpr-playback-media-probe.cjs`

**Then, only after offline test passes at a machine that can reach the private NVR:** `node face-lpr\\lpr-playback-media-smoke.cjs --manual-lpr-media-probe`

Do not commit, build, push, or publish an updater release until a real NVR trial has been reviewed.
