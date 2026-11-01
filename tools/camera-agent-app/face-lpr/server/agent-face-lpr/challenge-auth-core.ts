/** Stage 23.19: signed, bounded request proof for Face/LPR challenge issuance. */
export const CHALLENGE_AUTH_CONTEXT = 'CCTV-AGENT-FACE-LPR-CHALLENGE-V1';
const UUID_RE = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const NONCE_RE = /^[0-9a-f]{64}$/;
const VERSION_RE = /^[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,4}(?:[-+][A-Za-z0-9.-]{1,32})?$/;
const UTC_RE = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;
const B64_RE = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const SIGNED_KEYS = 'action,agentVersion,deviceId,issuedAt,requestNonce,signatureBase64';

export class ChallengeAuthError extends Error {
  constructor(message = 'Invalid challenge authentication') {
    super(message); this.name = 'ChallengeAuthError';
  }
}
function reject(): never { throw new ChallengeAuthError(); }

function decodeBase64(raw: string, maxBytes: number): Uint8Array {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > Math.ceil(maxBytes / 3) * 4 || !B64_RE.test(raw)) reject();
  let binary: string;
  try { binary = atob(raw); } catch { return reject(); }
  if (binary.length === 0 || binary.length > maxBytes || btoa(binary) !== raw) reject();
  return Uint8Array.from(binary, x => x.charCodeAt(0));
}
export type SignedChallengeRequest = {
  action: 'challenge';
  deviceId: string;
  agentVersion: string;
  issuedAt: string;
  requestNonce: string;
  signatureBase64: string;
};
export function parseSignedChallengeRequest(data: unknown): SignedChallengeRequest {
  if (!data || typeof data !== 'object' || Array.isArray(data) ||
      Object.keys(data).sort().join(',') !== SIGNED_KEYS) reject();
  const v = data as Record<string, unknown>;
  if (v.action !== 'challenge' || typeof v.deviceId !== 'string' || !UUID_RE.test(v.deviceId) ||
      typeof v.agentVersion !== 'string' || !VERSION_RE.test(v.agentVersion) ||
      typeof v.requestNonce !== 'string' || !NONCE_RE.test(v.requestNonce) ||
      typeof v.issuedAt !== 'string' || !UTC_RE.test(v.issuedAt) ||
      typeof v.signatureBase64 !== 'string') reject();
  const at = Date.parse(v.issuedAt as string);
  if (!Number.isFinite(at) || new Date(at).toISOString() !== v.issuedAt) reject();
  const sig = decodeBase64(v.signatureBase64 as string, 64);
  if (sig.length !== 64) reject();
  return v as SignedChallengeRequest;
}
export function signingBytes(req: Pick<SignedChallengeRequest,
  'deviceId' | 'agentVersion' | 'issuedAt' | 'requestNonce'>): Uint8Array {
  return new TextEncoder().encode([
    CHALLENGE_AUTH_CONTEXT,
    req.deviceId,
    req.agentVersion,
    req.issuedAt,
    req.requestNonce,
  ].join('\n'));
}
export async function verifySignedChallengeRequest(
  request: SignedChallengeRequest, publicKeyPem: string,
  nowMs: number = Date.now(),
): Promise<boolean> {
  const v = parseSignedChallengeRequest(request);
  if (!Number.isFinite(nowMs) || Math.abs(nowMs - Date.parse(v.issuedAt)) > 90_000) reject();
  const pem = typeof publicKeyPem === 'string' && publicKeyPem.match(
    /^-----BEGIN PUBLIC KEY-----\s+([A-Za-z0-9+/\s=]+)\s+-----END PUBLIC KEY-----\s*$/,
  );
  if (!pem) reject();
  const der = decodeBase64(pem[1].replace(/\s/g, ''), 512);
  let key: CryptoKey;
  try { key = await crypto.subtle.importKey('spki', der, { name: 'Ed25519' }, false, ['verify']); }
  catch { return reject(); }
  return crypto.subtle.verify('Ed25519', key, decodeBase64(v.signatureBase64, 64), signingBytes(v));
}
