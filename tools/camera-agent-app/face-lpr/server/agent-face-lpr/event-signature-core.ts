/**
 * Stage 23.11: offline-only Ed25519 event-signature verification primitives.
 * This file is NOT imported by the deployed challenge-only index.ts yet.
 * Does not issue/consume challenges, write events, or handle media uploads.
 */
export const EVENT_SIGNATURE_CONTEXT = 'CCTV-AGENT-FACE-LPR-V1';
export const MAX_EVENT_PAYLOAD_BYTES = 16 * 1024;
const UUID_RE = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const NONCE_RE = /^[0-9a-f]{64}$/;
const VERSION_RE = /^[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,4}(?:[-+][A-Za-z0-9.-]{1,32})?$/;
const B64_RE = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

export class EventSignatureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EventSignatureError';
  }
}

function reject(): never {
  throw new EventSignatureError('Invalid signed event envelope');
}

function decodeStrictBase64(raw: string, maxBytes: number): Uint8Array {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > Math.ceil(maxBytes / 3) * 4 ||
      !B64_RE.test(raw)) reject();
  let binary: string;
  try {
    binary = atob(raw);
  } catch {
    return reject();
  }
  if (binary.length === 0 || binary.length > maxBytes) reject();
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  // Reject alternative/non-canonical base64 encodings.
  let canonical = '';
  for (let i = 0; i < bytes.length; i += 0x4000) {
    canonical += String.fromCharCode(...bytes.subarray(i, i + 0x4000));
  }
  if (btoa(canonical) !== raw) reject();
  return bytes;
}

export function decodeCanonicalEventPayload(payloadBase64: string): Uint8Array {
  const bytes = decodeStrictBase64(payloadBase64, MAX_EVENT_PAYLOAD_BYTES);
  let data: unknown;
  let decoded: string;
  try {
    decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    data = JSON.parse(decoded);
  } catch {
    return reject();
  }
  // Reject whitespace, duplicated keys and ambiguous alternate encodings;
  // the signed bytes are exactly the bytes the server later parses.
  if (!data || typeof data !== 'object' || Array.isArray(data) ||
      JSON.stringify(data) !== decoded) reject();
  return bytes;
}

export function canonicalSigningFields(input: {
  challengeId: string;
  deviceId: string;
  nonce: string;
  agentVersion: string;
}): string[] {
  if (!input || !UUID_RE.test(input.challengeId) || !UUID_RE.test(input.deviceId) ||
      !NONCE_RE.test(input.nonce) || !VERSION_RE.test(input.agentVersion)) reject();
  return [EVENT_SIGNATURE_CONTEXT, input.challengeId, input.deviceId, input.nonce, input.agentVersion];
}

export async function buildSignedEventMessage(input: {
  challengeId: string;
  deviceId: string;
  nonce: string;
  agentVersion: string;
  payloadBase64: string;
}): Promise<Uint8Array> {
  const fields = canonicalSigningFields(input);
  const payloadBytes = decodeCanonicalEventPayload(input.payloadBase64);
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', payloadBytes));
  const payloadHash = Array.from(hash, b => b.toString(16).padStart(2, '0')).join('');
  return new TextEncoder().encode([...fields, payloadHash].join('\n'));
}

export async function verifyFaceLprEventSignature(input: {
  challengeId: string;
  deviceId: string;
  nonce: string;
  agentVersion: string;
  payloadBase64: string;
  signatureBase64: string;
  publicKeyPem: string;
}): Promise<boolean> {
  const message = await buildSignedEventMessage(input);
  const signature = decodeStrictBase64(input.signatureBase64, 64);
  if (signature.byteLength !== 64) reject();
  const match = typeof input.publicKeyPem === 'string' && input.publicKeyPem.match(
    /^-----BEGIN PUBLIC KEY-----\s+([A-Za-z0-9+/\s=]+)\s+-----END PUBLIC KEY-----\s*$/,
  );
  if (!match) reject();
  const der = decodeStrictBase64(match[1].replace(/\s/g, ''), 512);
  let key: CryptoKey;
  try {
    key = await crypto.subtle.importKey('spki', der, { name: 'Ed25519' }, false, ['verify']);
  } catch {
    return reject();
  }
  return crypto.subtle.verify('Ed25519', key, signature, message);
}
