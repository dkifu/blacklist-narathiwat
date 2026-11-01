import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  MAX_REQUEST_BYTES,
  RequestError,
  generateNonce,
} from './challenge-core.ts';
import {
  EventSignatureError,
  decodeCanonicalEventPayload,
  verifyFaceLprEventSignature,
} from './event-signature-core.ts';
import {
  ChallengeAuthError,
  parseSignedChallengeRequest,
  verifySignedChallengeRequest,
} from './challenge-auth-core.ts';

/**
 * Stage 23.19 server wiring; intentionally FAIL-CLOSED.
 * Changing this flag is a SEPARATE deployment decision after offline and
 * negative authorization tests, NVR access checks, and Agent-side signing.
 * Does not touch agent-heartbeat, existing Ping Agent, updater, or NVR settings.
 */
const EVENT_INGESTION_ENABLED = false;
const MAX_ENVELOPE_BYTES = 24 * 1024;
const UUID_RE = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const SAFE_CODE_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;
const HEX64_RE = /^[0-9a-f]{64}$/;
const EVENT_KEYS = [
  'centerId', 'eventKind', 'eventTimeLocal', 'faceCameraId', 'nvrId',
  'schemaVersion', 'similarityScore', 'sourceEventKey',
  'vehiclePersonAssociationConfirmed',
].sort().join(',');
const ENVELOPE_KEYS = [
  'action', 'agentVersion', 'challengeId', 'deviceId', 'nonce',
  'payloadBase64', 'signatureBase64',
].sort().join(',');

function json(data: unknown, status = 200): Response {
  return Response.json(data, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Face-LPR-Stage': '23.19',
    },
  });
}

async function readSmallJson(req: Request): Promise<{body: unknown; byteLength: number}> {
  if (!req.body) throw new RequestError(400, 'Invalid JSON');
  const reader = req.body.getReader();
  const pieces: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_ENVELOPE_BYTES) {
        await reader.cancel().catch(() => {});
        throw new RequestError(413, 'Request too large');
      }
      pieces.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const piece of pieces) {
    bytes.set(piece, offset);
    offset += piece.length;
  }
  try {
    return {
      body: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)),
      byteLength: total,
    };
  } catch {
    throw new RequestError(400, 'Invalid JSON');
  }
}

type EventPayload = {
  centerId: number;
  nvrId: string;
  faceCameraId: string;
  sourceEventKey: string;
  eventTimeLocal: string;
  similarityScore: number;
};

function validLocalTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(value)) return false;
  const test = new Date(value.replace(' ', 'T') + 'Z');
  return !Number.isNaN(test.getTime()) &&
    test.toISOString().slice(0, 19).replace('T', ' ') === value;
}

function readEventPayload(payloadBase64: string): EventPayload {
  let data: unknown;
  try {
    const bytes = decodeCanonicalEventPayload(payloadBase64);
    data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new RequestError(400, 'Invalid event payload');
  }
  if (!data || typeof data !== 'object' || Array.isArray(data) ||
      Object.keys(data).sort().join(',') !== EVENT_KEYS) {
    throw new RequestError(400, 'Invalid event payload');
  }
  const p = data as Record<string, unknown>;
  if (p.schemaVersion !== 1 || p.eventKind !== 'face_lpr_high_risk' ||
      p.vehiclePersonAssociationConfirmed !== false ||
      !Number.isSafeInteger(p.centerId) || (p.centerId as number) <= 0 ||
      typeof p.nvrId !== 'string' || !SAFE_CODE_RE.test(p.nvrId) ||
      typeof p.faceCameraId !== 'string' || !SAFE_CODE_RE.test(p.faceCameraId) ||
      typeof p.sourceEventKey !== 'string' || !HEX64_RE.test(p.sourceEventKey) ||
      !validLocalTimestamp(p.eventTimeLocal) ||
      typeof p.similarityScore !== 'number' ||
      !Number.isFinite(p.similarityScore) || p.similarityScore < 90 || p.similarityScore > 100 ||
      Math.round(p.similarityScore * 100) !== p.similarityScore * 100) {
    throw new RequestError(400, 'Invalid event payload');
  }
  return p as EventPayload;
}

function createAdmin() {
  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceKey) throw new RequestError(503, 'Service unavailable');
  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  try {
    const { body, byteLength } = await readSmallJson(req);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new RequestError(400, 'Invalid request');
    }
    const obj = body as Record<string, unknown>;
    if (obj.action === 'submit' || obj.action === 'upload') {
      return json({ error: 'Event ingestion disabled' }, 503);
    }
    if (obj.action === 'event') {
      // OFF: zero DB/permission/challenge/event writes, even with a signed request.
      if (!EVENT_INGESTION_ENABLED) return json({ error: 'Event ingestion disabled' }, 503);
      if (Object.keys(obj).sort().join(',') !== ENVELOPE_KEYS ||
          typeof obj.deviceId !== 'string' || !UUID_RE.test(obj.deviceId) ||
          typeof obj.challengeId !== 'string' || !UUID_RE.test(obj.challengeId) ||
          typeof obj.nonce !== 'string' || !HEX64_RE.test(obj.nonce) ||
          typeof obj.agentVersion !== 'string' ||
          typeof obj.payloadBase64 !== 'string' ||
          typeof obj.signatureBase64 !== 'string') {
        throw new RequestError(400, 'Invalid event envelope');
      }
      const payload = readEventPayload(obj.payloadBase64);
      const admin = createAdmin();
      const { data: device, error: deviceError } = await admin
        .from('client_devices').select('id,public_key,status,center_id,linked_at')
        .eq('id', obj.deviceId).maybeSingle();
      if (deviceError) throw new RequestError(503, 'Service unavailable');
      if (!device || device.status !== 'active' || device.center_id !== payload.centerId ||
          device.linked_at == null || !device.public_key) {
        throw new RequestError(403, 'Event not authorized');
      }
      let valid = false;
      try {
        valid = await verifyFaceLprEventSignature({
          deviceId: obj.deviceId,
          challengeId: obj.challengeId,
          nonce: obj.nonce,
          agentVersion: obj.agentVersion,
          payloadBase64: obj.payloadBase64,
          signatureBase64: obj.signatureBase64,
          publicKeyPem: device.public_key,
        });
      } catch (error) {
        if (!(error instanceof EventSignatureError)) throw error;
      }
      if (!valid) throw new RequestError(403, 'Event not authorized');
      // AUTHORIZED SIGNATURE != AUTHORIZED EVENT.
      // The RPC rechecks active NVR/cameras/mapping/primary assignment/permission,
      // then consumes challenge and inserts event in one atomic transaction.
      const { data, error } = await admin.rpc('face_lpr_accept_signed_event', {
        p_device_id: obj.deviceId,
        p_challenge_id: obj.challengeId,
        p_nonce: obj.nonce,
        p_center_id: payload.centerId,
        p_nvr_id: payload.nvrId,
        p_face_camera_id: payload.faceCameraId,
        p_source_event_key: payload.sourceEventKey,
        p_event_time_local: payload.eventTimeLocal,
        p_similarity_score: payload.similarityScore,
      });
      if (error) {
        if (error.code === '42501') throw new RequestError(403, 'Event not authorized');
        if (error.code === '22023') throw new RequestError(400, 'Invalid event');
        throw new RequestError(503, 'Service unavailable');
      }
      const result = Array.isArray(data) ? data[0] : null;
      if (!result || !result.event_id) throw new RequestError(503, 'Service unavailable');
      return json({ success: true, eventId: result.event_id, duplicate: !result.was_inserted });
    }
    if (obj.action !== 'challenge') throw new RequestError(400, 'Invalid request');
    if (byteLength > MAX_REQUEST_BYTES) throw new RequestError(413, 'Request too large');
    let signedRequest;
    try { signedRequest = parseSignedChallengeRequest(body); }
    catch (error) {
      if (error instanceof ChallengeAuthError) throw new RequestError(400, 'Invalid signed challenge request');
      throw error;
    }
    const deviceId = signedRequest.deviceId;
    const admin = createAdmin();
    const { data: device, error: deviceError } = await admin
      .from('client_devices').select('id,public_key,status,center_id,linked_at')
      .eq('id', deviceId).maybeSingle();
    if (deviceError) throw new RequestError(503, 'Service unavailable');
    if (!device || device.status !== 'active' || device.center_id == null ||
        device.linked_at == null || !device.public_key) {
      throw new RequestError(403, 'Device not authorized');
    }
    let valid = false;
    try {
      valid = await verifySignedChallengeRequest(signedRequest, device.public_key);
    } catch (error) {
      if (!(error instanceof ChallengeAuthError)) throw error;
    }
    if (!valid) throw new RequestError(403, 'Device not authorized');
    // DB enforces permission, 3-pending limit and per-device request nonce uniqueness atomically.
    const { data, error } = await admin.rpc('face_lpr_issue_authenticated_event_challenge', {
      p_device_id: deviceId,
      p_event_nonce: generateNonce(),
      p_request_nonce: signedRequest.requestNonce,
      p_issued_at: signedRequest.issuedAt,
    });
    if (error) {
      if (error.code === '42501') throw new RequestError(403, 'Device not authorized');
      if (error.code === '22023') throw new RequestError(403, 'Device not authorized');
      if (error.code === 'P0001' && error.message === 'Challenge rate limit reached') {
        throw new RequestError(429, 'Challenge rate limit reached');
      }
      throw new RequestError(503, 'Service unavailable');
    }
    const challenge = Array.isArray(data) ? data[0] : null;
    if (!challenge?.challenge_id || !challenge.nonce || !challenge.expires_at) {
      throw new RequestError(503, 'Service unavailable');
    }
    return json({
      success: true,
      deviceId,
      challengeId: challenge.challenge_id,
      nonce: challenge.nonce,
      expiresAt: challenge.expires_at,
      protocol: 'CCTV-AGENT-FACE-LPR-V1',
      eventSubmissionEnabled: EVENT_INGESTION_ENABLED,
    });
  } catch (error) {
    if (error instanceof RequestError) return json({ error: error.message }, error.status);
    // No request bodies, URLs, device identities, or credentials in logs.
    console.error('[AGENT-FACE-LPR] Unhandled request failure');
    return json({ error: 'Internal server error' }, 500);
  }
});
