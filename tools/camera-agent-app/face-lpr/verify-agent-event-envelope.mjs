import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { buildSignedFaceLprEnvelope } = require('./agent-event-envelope.cjs');
const deviceId = '7676691c-9a2e-416f-b982-19360178dfe6';
const challengeId = '12345678-1234-4123-8123-123456789abc';
const challenge = {
  success: true, deviceId, challengeId, nonce: 'a'.repeat(64),
  expiresAt: new Date(Date.now() + 120000).toISOString(),
  protocol: 'CCTV-AGENT-FACE-LPR-V1', eventSubmissionEnabled: true,
};
const payload = {
  schemaVersion: 1, eventKind: 'face_lpr_high_risk', centerId: 1,
  nvrId: 'yakang-nvr-01', faceCameraId: 'CAM9',
  sourceEventKey: createHash('sha256').update('DEMO-ONLY-IMMUTABLE-NVR-ID').digest('hex'),
  eventTimeLocal: '2026-10-31 12:34:15', similarityScore: 91,
  vehiclePersonAssociationConfirmed: false,
};
const { privateKey, publicKey } = generateKeyPairSync('ed25519', {
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});
const build = args => buildSignedFaceLprEnvelope({
  deviceId, agentVersion: '1.0.11', challenge, payload,
  signBytes: bytes => sign(null, bytes, privateKey), ...args,
});
const env = await build();
assert.equal(env.action, 'event');
const signed = JSON.parse(Buffer.from(env.payloadBase64, 'base64').toString('utf8'));
assert.equal(signed.vehiclePersonAssociationConfirmed, false);
assert.equal(signed.eventKind, 'face_lpr_high_risk');
// Test against server's exact TypeScript verifier from Stage 23.16.
const { verifyFaceLprEventSignature } = await import('./server/agent-face-lpr/event-signature-core.ts');
const verify = data => verifyFaceLprEventSignature({
  ...data, publicKeyPem: publicKey,
});
assert.equal(await verify(env), true);
assert.equal(await verify({ ...env, deviceId: '443182fc-033d-4092-88b8-aae627f0cee6' }), false);
assert.equal(await verify({ ...env, nonce: 'b'.repeat(64) }), false);
assert.equal(await verify({ ...env, signatureBase64: Buffer.alloc(64).toString('base64') }), false);
const tampered = { ...signed, similarityScore: 92 };
assert.equal(await verify({ ...env, payloadBase64: Buffer.from(JSON.stringify(tampered)).toString('base64') }), false);
await assert.rejects(build({ challenge: { ...challenge, eventSubmissionEnabled: false } }), /disabled/);
await assert.rejects(build({ payload: { ...payload, vehiclePersonAssociationConfirmed: true } }), /unverified/);
await assert.rejects(build({ payload: { ...payload, extra: 42 } }), /Unexpected/);
console.log('FACE_LPR_AGENT_EVENT_ENVELOPE_OFFLINE_TEST: PASS');
console.log('SIGNED_PAYLOAD_MATCHES_SERVER_VERIFIER: YES');
console.log('EVENT_INGESTION_ENABLED: NO');
console.log('REAL_SERVER_REQUEST_SENT: NO');
console.log('AGENT_MAIN_CHANGED: NO');
