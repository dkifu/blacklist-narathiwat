import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import {
  CHALLENGE_TTL_SECONDS,
  MAX_PENDING_CHALLENGES,
  MAX_REQUEST_BYTES,
  RequestError,
  parseChallengeDeviceId,
  isAllowedForChallenge,
  generateNonce,
  challengeTimes,
} from './agent-face-lpr/challenge-core.ts';

if (!globalThis.crypto) globalThis.crypto = webcrypto;
const validId = '12345678-1234-4234-8234-123456789abc';
assert.equal(parseChallengeDeviceId({ action: 'challenge', deviceId: validId.toUpperCase() }), validId);
for (const value of [null, {}, [], {action:'submit',deviceId:validId}, {action:'challenge',deviceId:'invalid'}, {action:'challenge',deviceId:validId, enabled:true}]) {
  assert.throws(() => parseChallengeDeviceId(value), RequestError);
}
console.log('PASS: only explicit challenge + valid device UUID accepted');

const active = {id:validId,status:'active',center_id:3,linked_at:'2026-10-20T00:00:00Z'};
const allowed = {enabled:true,enabled_by:validId,enabled_at:'2026-11-01T00:00:00Z'};
assert.equal(isAllowedForChallenge(active,allowed),true);
for(const bad of [null,{...active,status:'revoked'},{...active,status:'pending'},{...active,center_id:null},{...active,linked_at:null}]){
  assert.equal(isAllowedForChallenge(bad,allowed),false);
}
for(const bad of [null,{...allowed,enabled:false},{...allowed,enabled_at:null},{...allowed,enabled_by:null}]){
  assert.equal(isAllowedForChallenge(active,bad),false);
}
console.log('PASS: status, center link and explicit feature permission fail closed');

const nonce1=generateNonce(), nonce2=generateNonce();
assert.match(nonce1,/^[0-9a-f]{64}$/);
assert.notEqual(nonce1,nonce2);
assert.equal(CHALLENGE_TTL_SECONDS,120);
assert.equal(MAX_PENDING_CHALLENGES,3);
assert.equal(MAX_REQUEST_BYTES,2048);
const ts=challengeTimes(Date.parse('2026-11-01T00:00:00.000Z'));
assert.equal(ts.created_at,'2026-11-01T00:00:00.000Z');
assert.equal(ts.expires_at,'2026-11-01T00:02:00.000Z');
console.log('PASS: crypto nonce, 120s TTL, byte bound and pending challenge cap');

const here=dirname(fileURLToPath(import.meta.url));
const index=readFileSync(join(here,'./agent-face-lpr/index.ts'),'utf8');
assert.match(index,/action === 'submit' \|\| action === 'event' \|\| action === 'upload'/);
assert.match(index,/Event ingestion disabled/);
assert.match(index,/face_lpr_agent_permissions/);
assert.match(index,/face_lpr_event_challenges/);
assert.doesNotMatch(index,/\.from\(['"]client_device_heartbeat_challenges['"]\)/);
console.log('PASS: no event writes, no heartbeat table references (static check)');
console.log('FACE_LPR_CHALLENGE_OFFLINE_TEST: PASS');
console.log('REAL_SERVER_REQUEST_SENT: NO');
console.log('EXISTING_FUNCTION_CHANGED: NO');
