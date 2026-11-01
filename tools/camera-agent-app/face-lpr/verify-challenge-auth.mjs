import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { buildSignedChallengeRequest } = require('./agent-challenge-auth.cjs');
const { verifySignedChallengeRequest, parseSignedChallengeRequest } = await import('./server/agent-face-lpr/challenge-auth-core.ts');
const pair = generateKeyPairSync('ed25519', {
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});
const other = generateKeyPairSync('ed25519', { publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
const params = {
  deviceId: '7676691c-9a2e-416f-b982-19360178dfe6', agentVersion: '1.0.11',
  signBytes: bytes => sign(null, bytes, pair.privateKey),
};
const proof = await buildSignedChallengeRequest(params);
assert.equal(await verifySignedChallengeRequest(proof, pair.publicKey), true);
for (const prop of ['deviceId', 'agentVersion', 'issuedAt', 'requestNonce']) {
  const mutated = { ...proof };
  if (prop === 'deviceId') mutated.deviceId = '443182fc-033d-4092-88b8-aae627f0cee6';
  if (prop === 'agentVersion') mutated.agentVersion = '1.0.12';
  if (prop === 'issuedAt') mutated.issuedAt = new Date(Date.now() - 20_000).toISOString();
  if (prop === 'requestNonce') mutated.requestNonce = 'a'.repeat(64);
  assert.equal(await verifySignedChallengeRequest(mutated, pair.publicKey), false, `tampered ${prop}`);
}
assert.equal(await verifySignedChallengeRequest(proof, other.publicKey), false);
await assert.rejects(verifySignedChallengeRequest(proof, pair.publicKey, Date.now() + 91_000), /Invalid challenge authentication/);
for (const malformed of [
  { ...proof, signatureBase64: '!!' },
  { ...proof, signatureBase64: Buffer.alloc(4).toString('base64') },
  { ...proof, extra: 'yes' },
  { ...proof, issuedAt: 'not-a-date' },
]) assert.throws(() => parseSignedChallengeRequest(malformed));
const second = await buildSignedChallengeRequest(params);
assert.notEqual(second.requestNonce, proof.requestNonce);
console.log('FACE_LPR_SIGNED_CHALLENGE_OFFLINE_TEST: PASS');
console.log('SIGNED_REQUEST_MATCHES_SERVER_VERIFIER: YES');
console.log('REPLAY_ATOMIC_DB_TESTED: NO');
console.log('REAL_SERVER_REQUEST_SENT: NO');
console.log('EVENT_INGESTION_ENABLED: NO');
console.log('AGENT_MAIN_CHANGED: NO');
