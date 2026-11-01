# Stage 20.4 — RTSP Digest same-TCP diagnostic

Investigate real Dahua NVR RTSP `401` to the authenticated second DESCRIBE.
The original probe sends the second request on a new TCP socket. This new tool
checks whether the server requires its Digest nonce to be used on the same socket.
This is a **hypothesis**, not a confirmed reason for any real-world 401.

No existing project files are replaced. All three new scripts only send read-only
`DESCRIBE` requests. On mock they test nonce bound to a socket, wrong password,
and server closing connection after challenge. In a real run, the new probe sends
at most **one** authenticated retry; it never follows redirects or performs SETUP,
PLAY, or media download. No credentials in CLI, URLs, output, or disk. It reports
safe challenge metadata (algorithm, qop), HTTP-like RTSP status, reuse, and SDP presence.

From camera-agent-app:

```
node face-lpr\verify-rtsp-connection-diagnostic.cjs
```

Only when it passes and while on the approved NVR LAN:

```
node face-lpr\rtsp-connection-smoke.cjs --manual-same-connection-diagnostic
```

If this still gets 401, do not try many passwords or disable NVR security.
The next step is to inspect sanitized RTSP auth details/permissions, not assume missing video.
