'use strict';
// Pure signed request builder, no NVR, network, or disk access. Signing stays in Electron main.
const { randomBytes } = require('node:crypto');
const CONTEXT = 'CCTV-AGENT-FACE-LPR-CHALLENGE-V1';
const UUID_RE = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const VERSION_RE = /^[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,4}(?:[-+][A-Za-z0-9.-]{1,32})?$/;
async function buildSignedChallengeRequest({ deviceId, agentVersion, signBytes, nowMs = Date.now() }) {
  if (typeof deviceId !== 'string' || !UUID_RE.test(deviceId)) throw new Error('Invalid device ID');
  if (typeof agentVersion !== 'string' || !VERSION_RE.test(agentVersion)) throw new Error('Invalid agent version');
  if (typeof signBytes !== 'function') throw new Error('Signing callback required');
  if (!Number.isFinite(nowMs)) throw new Error('Invalid timestamp');
  const issuedAt = new Date(nowMs).toISOString();
  const requestNonce = randomBytes(32).toString('hex');
  const message = Buffer.from([CONTEXT, deviceId, agentVersion, issuedAt, requestNonce].join('\n'), 'utf8');
  const raw = await signBytes(message);
  const signature = Buffer.from(raw);
  if (signature.length !== 64) throw new Error('Invalid Ed25519 signature');
  return Object.freeze({
    action: 'challenge', deviceId, agentVersion, issuedAt, requestNonce,
    signatureBase64: signature.toString('base64'),
  });
}
module.exports = { buildSignedChallengeRequest };
