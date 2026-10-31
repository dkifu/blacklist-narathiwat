# Stage 19: read-only NVR image retrieval

- `face-image-client.cjs`: same-host Digest GET of historical face JPEGs under `/IntelliStorage/mnt/`; restricts NVR to private IPv4, path allowlist, redirects rejected, 4 MiB cap, compares expected length, validates JPEG markers.
- `verify-images.cjs`: self-contained localhost mock tests only; never calls real NVR.
- `face-image-smoke.cjs`: **manually invoked only**, searches the previously verified single pilot High Risk event at 2026-10-31 12:34:15, validates Candidate, then downloads both images into a newly created random temp directory **on the operator's computer**.
- Requires working `historical-face-client.cjs`, `high-risk-filter.cjs`, `config.cjs`, `nvr-client.cjs` from previous steps.
- This stage does not import or modify Electron `main.cjs`; `pilot.config.json` stays disabled; no Server, Supabase, LINE, Agent auto-start or persistent event queue involved.
- Do **not** upload photos or console details containing personal data to chat; delete the temporary output folder after operator-only visual comparison. The test keeps credentials only in local process memory; HTTP traffic inside the LAN is not encrypted. Prefer a restricted read-only NVR account for production.
- Real NVR authentication or session handling for the direct image endpoint is firmware-dependent; a local mock PASS does **not** prove real-image access. If the manual test fails with a 401/403 or session issue, stop and investigate before changing existing NVR or Agent settings.
- Image content can contain sensitive biometric data. No permanent archive is implemented in Stage 19.

Commands from `tools/camera-agent-app` on the NVR-reachable Windows workstation:

```bat
node face-lpr\verify-images.cjs
node face-lpr\face-image-smoke.cjs --manual-face-image-test
```
