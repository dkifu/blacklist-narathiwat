# Stage 12: Read-only Dahua NVR connector

New files only. Existing `main.cjs`, Ping, Heartbeat V2, updater, port 8765, and `pilot.config.json` remain unchanged. Do **not** change `enabled: false` in the pilot yet.

- `nvr-client.cjs`: uses built-in Node.js HTTP and crypto only; read-only Digest API (`getCaps`, `ChannelTitle`). Rejects non-private IPv4 addresses and redirects; no tokens in files.
- `verify-nvr.cjs`: local mock server test with no real NVR requests.
- `nvr-smoke.cjs`: optional manual pilot NVR test, `--read-only-pilot-test` explicitly required. Prompts for NVR password without showing it and does not save it to a file. Run this only AFTER the offline test passes.

From `tools/camera-agent-app`:

```cmd
node face-lpr\verify-nvr.cjs
node face-lpr\verify.cjs
node --check main.cjs
git status --short
```

Manual read-only NVR test (later, only when approved):

```cmd
node face-lpr\nvr-smoke.cjs --read-only-pilot-test
```

Security: Digest auth protects the password against being sent as plain text in the HTTP authentication header, but HTTP carries the response and metadata without transport encryption. Use only on the authorized internal camera network and protect all face/plate data. Do not use admin credentials in production; set up least-privileged credentials if supported.

Next steps after tests: investigate and implement FaceComparision SSE parsing and authenticated NVR image fetching, separate per-NVR credentials, lease/failover, offline queue, server auth, LPR snapshots, and online recipient notifications. None of those are implemented here.
