# Stage 20.6a: isolated H.264/RTP decoding preparation

This patch adds new files only. It does not modify the Agent, RTSP probe, NVR or any existing runtime module. The pilot remains disabled by default.

The module accepts in-memory RTP packet buffers and reconstructs H.264 Annex-B NAL units for single NAL, STAP-A and FU-A, with bounded memory and dropped-fragment protection. It also reads optional SPS/PPS parameter sets from the SDP. The test uses an entirely synthetic 160x96 video fixture, then invokes the installed FFmpeg **only on the synthetic video** to verify a JPEG can be decoded. No NVR network call is made and no video/image output is saved.

CMD from `tools/camera-agent-app`:

```
node face-lpr\verify-lpr-h264-rtp.cjs
node --check main.cjs
git status --short
```

Expected `LPR_H264_OFFLINE_TEST: PASS`. A subsequent patch will connect the collector to the already tested, bounded RTSP playback reader, and will then perform a separate manual live NVR test. Do not commit or deploy before reviewing results.
