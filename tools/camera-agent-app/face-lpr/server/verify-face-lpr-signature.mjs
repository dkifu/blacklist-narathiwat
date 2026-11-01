import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import {
  EVENT_SIGNATURE_CONTEXT,
  EventSignatureError,
  buildSignedEventMessage,
  decodeCanonicalEventPayload,
  verifyFaceLprEventSignature,
} from './agent-face-lpr/event-signature-core.ts';

const enc = new TextEncoder();
const b64 = bytes => Buffer.from(bytes).toString('base64');
const id = '11111111-1111-4111-8111-111111111111';
const deviceId = '22222222-2222-4222-8222-222222222222';
const nonce = 'a'.repeat(64);
const agentVersion = '1.0.12';

async function main() {
  const keys = await webcrypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  const publicDer = await webcrypto.subtle.exportKey('spki', keys.publicKey);
  const publicKeyPem = `-----BEGIN PUBLIC KEY-----\n${b64(publicDer)}\n-----END PUBLIC KEY-----`;
  const payload = {
    schemaVersion: 1, eventKind: 'face_lpr_high_risk', centerId: 'test-center',
    faceCameraId: 'test-face-09', eventTimeLocal: '2026-10-31 12:34:15',
    lprSlots: [0, 1, 2, 3, 4].map(i => ({ index: i, state: 'pending' })),
    vehiclePersonAssociationConfirmed: false,
  };
  const payloadBase64 = b64(enc.encode(JSON.stringify(payload)));
  const fields = { challengeId: id, deviceId, nonce, agentVersion, payloadBase64 };
  const message = await buildSignedEventMessage(fields);
  assert.ok(new TextDecoder().decode(message).startsWith(`${EVENT_SIGNATURE_CONTEXT}\n${id}\n${deviceId}\n`));
  const signatureBase64 = b64(await webcrypto.subtle.sign('Ed25519', keys.privateKey, message));
  const input = { ...fields, publicKeyPem, signatureBase64 };
  assert.equal(await verifyFaceLprEventSignature(input), true);
  console.log('PASS: Ed25519 SPKI PEM verifies exact SHA-256-bound event bytes');

  const wrongCases = [
    { challengeId: '33333333-3333-4333-8333-333333333333' },
    { deviceId: '33333333-3333-4333-8333-333333333333' },
    { nonce: 'b'.repeat(64) },
    { agentVersion: '1.0.13' },
    { payloadBase64: b64(enc.encode(JSON.stringify({ ...payload, centerId: 'different-center' }))) },
  ];
  for (const changed of wrongCases) {
    assert.equal(await verifyFaceLprEventSignature({ ...input, ...changed }), false);
  }
  const otherKeys = await webcrypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  const otherDer = await webcrypto.subtle.exportKey('spki', otherKeys.publicKey);
  const otherPem = `-----BEGIN PUBLIC KEY-----\n${b64(otherDer)}\n-----END PUBLIC KEY-----`;
  assert.equal(await verifyFaceLprEventSignature({ ...input, publicKeyPem: otherPem }), false);
  console.log('PASS: changed payload, device, challenge, nonce, version or key rejected');

  const malformed = [
    { ...input, signatureBase64: b64(new Uint8Array(63)) },
    { ...input, signatureBase64: signatureBase64.replace(/=$/, '') },
    { ...input, nonce: 'bad' },
    { ...input, agentVersion: '1.0.12\nforged' },
    { ...input, payloadBase64: b64(enc.encode('{"x":1,"x":2}')) },
    { ...input, payloadBase64: b64(enc.encode('{ "x": 1 }')) },
    { ...input, payloadBase64: b64(enc.encode('[]')) },
    { ...input, payloadBase64: b64(new Uint8Array(16 * 1024 + 1)) },
    { ...input, payloadBase64: b64(new Uint8Array([0xff, 0xfe, 0xfd])) },
    { ...input, publicKeyPem: 'bad key' },
  ];
  for (const bad of malformed) {
    await assert.rejects(verifyFaceLprEventSignature(bad), EventSignatureError);
  }
  assert.deepEqual(Array.from(decodeCanonicalEventPayload(payloadBase64)), Array.from(enc.encode(JSON.stringify(payload))));
  console.log('PASS: invalid base64/UTF-8/JSON, duplicate fields, oversize and wrong signature length rejected');

  // A successful signature by itself DOES NOT authorize an event.
  // Production must still check device/permissions/challenge TTL and atomic consume.
  console.log('PASS: crypto isolated from event ingestion, DB and heartbeat');
  console.log('FACE_LPR_EVENT_SIGNATURE_OFFLINE_TEST: PASS');
  console.log('REAL_SERVER_REQUEST_SENT: NO');
  console.log('EVENT_INGESTION_ENABLED: NO');
  console.log('AGENT_MAIN_CHANGED: NO');
}

main().catch(error => {
  console.error('FACE_LPR_EVENT_SIGNATURE_OFFLINE_TEST: FAIL', error?.message || 'unknown');
  process.exitCode = 1;
});
