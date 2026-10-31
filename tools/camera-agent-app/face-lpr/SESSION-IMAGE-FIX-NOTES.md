# Stage 19 Session Cookie Fix (read-only pilot)

## Confirmed cause

The real Dahua NVR returned HTTP 404 for anonymous and Digest-only image requests, but HTTP 200 + valid JPEG for Cookie-only and Digest+Cookie requests. The image files must be fetched while the Finder session is still active and using the same in-memory Cookie jar. The image URL must preserve a literal `:` character in IntelliStorage filenames.

## Changes

- `historical-face-client.cjs`: backward-compatible optional `onResult` callback invoked after `findNextFile` and before `close`/`destroy`. Only passes a temporary `getJpeg` function; the cookie never leaves the client's closure. The historical `search()` API behaves identically when `onResult` is not supplied.
- `face-image-client.cjs`: optional `cookieProvider` for a same-host image request, while retaining existing path validation, MIME/JPEG validation, size limits and redirect rejection. Old Digest-only use remains supported for compatible NVRs.
- `face-image-smoke.cjs`: verifies and downloads BOTH face JPEGs during the open Finder session, confirms session cleanup before saving images to a temporary local folder; no partial image files on failure.
- `verify-session-images.cjs`: offline regression test that simulates the actual 404-without-Cookie behavior; verifies both images download before session cleanup and verifies cleanup on image error.

## Safety & compatibility

- No edits to `main.cjs`, Ping, Heartbeat V2, Local HTTP 8765, auto-updater, or production server.
- Pilot remains disabled. No auto-start, no Server/LINE upload, no stored NVR credentials.
- NVR test only reads event records and JPEGs. Finder create/close/destroy concern query sessions, not recorder configuration.
- Do not commit the patch until it passes the real-NVR pilot. Images contain personal data; delete temporary test images after inspection.
- NVR uses plain HTTP on the LAN; credentials/session cookies and image data are not encrypted in transit. Restrict access to trusted network and least-privilege accounts.
