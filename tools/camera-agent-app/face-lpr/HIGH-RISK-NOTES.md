# Stage 17 — High Risk classifier (offline only)

Add **only** these files to `face-lpr/`. Nothing changes in `main.cjs`, `package.json`, backend, update manifests, Ping, or Heartbeat.

## Scope

`high-risk-filter.cjs` exports pure functions:

- `evaluateLiveFaceEvent({config,nvrId,event,minSimilarity,groupName})`
- `evaluateHistoricalFaceRecord({config,nvrId,fields,index,minSimilarity,groupName})`

Both require **valid, enabled configuration for explicit test input** and a configured, enabled NVR; the checked-in pilot configuration remains disabled. This module has no automatic startup or network activity. It does not authenticate to NVR, download images, persist event keys, dispatch alerts, or make any external requests.

Only a candidate with a **matching explicit `Person.GroupName`**, its **own** `Similarity >= 90`, and an available `Person.Name` qualifies. Other groups, missing candidate/group/score, non-Face channels, and unexpected actions are ignored. The score is the NVR's similarity estimate, not proof of identity.

Dahua live payloads are not guaranteed to contain the same fields as historical `SummaryNew` records. Unknown live schemas **fail closed** (no qualification); a positive live High Risk event is not yet verified on the real NVR. `Face.Candidates` and root `Candidates` are candidate locations to investigate; root `Sim`/`Name` alone are intentionally not enough. Historical records can be normalized from `SummaryNew[0]` field names, but this stage only tests **synthetic fixtures**, not a real historical CGI query.

Source NVR ID + camera channel are checked against the config, LPR mappings can reference cameras across multiple NVRs. Candidate selection is per person (do not mix group from one with score from another). `personId` is **always an empty string** regardless of what NVR/DSS may contain.

`qualified: true` means **potential event pending validation and enrichment**, NOT an alert to send. `eventKey: null` and `verifiedImagePair: false` flag unfinished work. No match is auto-associated with a vehicle. Server-side deduplication, secure credentials, actual live-event schema verification and image retrieval are separate next stages.

## Test (Windows CMD, from camera-agent-app)

```cmd
node face-lpr\verify-high-risk.cjs
node face-lpr\verify-events.cjs
node face-lpr\verify-nvr.cjs
node face-lpr\verify.cjs
node --check main.cjs
git status --short
```

Expected: `HIGH_RISK_OFFLINE_TEST: PASS`, `REAL_NVR_REQUEST_SENT: NO`, `SERVER_UPLOAD: NO`, `AGENT_MAIN_CHANGED: NO`.

Do not commit, build, publish updates or enable the pilot until review.
