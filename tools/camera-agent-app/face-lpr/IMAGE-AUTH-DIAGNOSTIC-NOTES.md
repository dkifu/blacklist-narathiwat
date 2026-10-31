# Stage 19 — Image authentication diagnostic (NOT a patch)

Read-only **manual** diagnostic for a verified historical High Risk event on the Yakang pilot Dahua NVR.

- Uses the existing `nvr-client.cjs` Digest helpers and patched `face-image-client.cjs` URL validation.
- Builds a historical CGI Finder, reads **only** the detected-face image reference, then tests four one-image HTTP requests while the Finder remains open: anonymous, Digest only, Cookie only, Digest + Cookie.
- Reports only HTTP status and whether response is verified JPEG; never outputs names, IDs, image paths, Cookie or Authorization header values.
- No image saved to disk, no NVR changes, no Server or LINE upload, no Electron integration.
- The script closes and destroys its Finder in `finally`, including when a request fails; reports whether cleanup was confirmed.
- Handles credentials in memory; HTTP on the LAN is not encrypted. Run only on an authorized workstation/network.
- Investigational only: DO NOT commit until the real-NVR output has been evaluated.

From CMD at `tools/camera-agent-app`:

```bat
node face-lpr\verify-image-auth-diagnostic.cjs
node face-lpr\diagnose-image-auth.cjs --manual-image-auth-diagnostic
```
