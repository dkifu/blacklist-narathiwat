import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  MAX_PENDING_CHALLENGES,
  MAX_REQUEST_BYTES,
  RequestError,
  challengeTimes,
  generateNonce,
  isAllowedForChallenge,
  parseChallengeDeviceId,
} from './challenge-core.ts';

/**
 * Face/LPR API, stage 23 pilot. CHALLENGE ONLY. NO EVENT INGESTION.
 * Existing agent-heartbeat code/tables are not read or modified here.
 * Access is DENIED unless an admin has explicitly enabled a linked device.
 */
function json(data: unknown, status = 200): Response {
  return Response.json(data, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

async function readSmallJson(req: Request): Promise<unknown> {
  // Enforce a hard byte bound WHILE reading, not after buffering the whole body.
  if (!req.body) throw new RequestError(400, 'Invalid JSON');
  const reader = req.body.getReader();
  const pieces: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_REQUEST_BYTES) {
        await reader.cancel().catch(() => {});
        throw new RequestError(413, 'Request too large');
      }
      pieces.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const piece of pieces) {
    bytes.set(piece, offset);
    offset += piece.length;
  }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new RequestError(400, 'Invalid JSON');
  }
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const body = await readSmallJson(req);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new RequestError(400, 'Invalid request');
    }
    const action = (body as Record<string, unknown>).action;

    // Strictly no event ingestion, signature checks, uploads or notifications yet.
    // Never accept an event just because the gateway has VERIFY_JWT=false.
    if (action === 'submit' || action === 'event' || action === 'upload') {
      return json({ error: 'Event ingestion disabled' }, 503);
    }
    if (action !== 'challenge') throw new RequestError(400, 'Invalid request');
    const deviceId = parseChallengeDeviceId(body);

    const url = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !serviceKey) throw new RequestError(503, 'Service unavailable');
    const admin = createClient(url, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: device, error: deviceError } = await admin
      .from('client_devices')
      .select('id,status,center_id,linked_at')
      .eq('id', deviceId).maybeSingle();
    if (deviceError) throw new RequestError(503, 'Service unavailable');
    if (!device || device.status !== 'active' ||
        device.center_id == null || device.linked_at == null) {
      throw new RequestError(403, 'Device not authorized');
    }

    const { data: permission, error: permissionError } = await admin
      .from('face_lpr_agent_permissions')
      .select('enabled,enabled_by,enabled_at')
      .eq('device_id', deviceId).maybeSingle();
    if (permissionError) throw new RequestError(503, 'Service unavailable');
    if (!isAllowedForChallenge(device, permission)) {
      throw new RequestError(403, 'Device not authorized');
    }

    const times = challengeTimes(Date.now());
    const { count, error: countError } = await admin
      .from('face_lpr_event_challenges')
      .select('id', { count: 'exact', head: true })
      .eq('device_id', deviceId)
      .is('consumed_at', null)
      .gt('expires_at', times.created_at);
    if (countError || count == null) throw new RequestError(503, 'Service unavailable');
    if (count >= MAX_PENDING_CHALLENGES) {
      throw new RequestError(429, 'Challenge rate limit reached');
    }

    const { data: challenge, error: insertError } = await admin
      .from('face_lpr_event_challenges')
      .insert({ device_id: deviceId, nonce: generateNonce(), ...times })
      .select('id,nonce,expires_at').single();
    if (insertError || !challenge) throw new RequestError(503, 'Service unavailable');

    return json({
      success: true,
      deviceId,
      challengeId: challenge.id,
      nonce: challenge.nonce,
      expiresAt: challenge.expires_at,
      protocol: 'CCTV-AGENT-FACE-LPR-V1',
      eventSubmissionEnabled: false,
    });
  } catch (error) {
    if (error instanceof RequestError) return json({ error: error.message }, error.status);
    // Do not log request body, credentials, device identifiers or service key.
    console.error('[AGENT-FACE-LPR] Unhandled request failure');
    return json({ error: 'Internal server error' }, 500);
  }
});
