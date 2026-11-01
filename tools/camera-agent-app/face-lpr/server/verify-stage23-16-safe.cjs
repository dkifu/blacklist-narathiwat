'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { stripTypeScriptTypes } = require('node:module');
const root = __dirname;
const mainPath = path.join(root, 'agent-face-lpr', 'index.ts');
const sqlPath = path.join(root, 'sql', '23_16_atomic_event_rpc.sql');
const main = fs.readFileSync(mainPath, 'utf8');
const sql = fs.readFileSync(sqlPath, 'utf8');
assert.match(main, /const EVENT_INGESTION_ENABLED = false;/);
assert.match(main, /if \(!EVENT_INGESTION_ENABLED\) return json\(\{ error: 'Event ingestion disabled' \}, 503\);/);
assert.match(main, /verifyFaceLprEventSignature/);
assert.match(main, /rpc\('face_lpr_accept_signed_event'/);
assert.match(main, /rpc\('face_lpr_issue_event_challenge'/);
assert.match(sql, /pg_advisory_xact_lock/);
assert.match(sql, /SET consumed_at\s*=\s*transaction_timestamp\(\)/i);
assert.match(sql, /ON CONFLICT ON CONSTRAINT face_lpr_event_unique_source DO NOTHING/);
assert.match(sql, /FROM PUBLIC, anon, authenticated/);
// Node's --check does not strip TypeScript annotations from a .ts file.
// Strip in-memory first, then syntax-check the resulting ES module via stdin.
const parsed = spawnSync(process.execPath, ['--check', '--input-type=module'], {
  input: stripTypeScriptTypes(main, { mode: 'strip' }),
  encoding: 'utf8',
});
if (parsed.status !== 0) {
  process.stderr.write(parsed.stderr || 'TypeScript syntax check failed\n');
  process.exit(parsed.status || 1);
}
console.log('STAGE23_16_STATIC_SAFETY_CHECK: PASS');
console.log('EVENT_INGESTION_ENABLED: NO');
console.log('REAL_SERVER_REQUEST_SENT: NO');
console.log('POSTGRESQL_INTEGRATION_TESTED: NO');
console.log('EXISTING_AGENT_MAIN_CHANGED: NO');
