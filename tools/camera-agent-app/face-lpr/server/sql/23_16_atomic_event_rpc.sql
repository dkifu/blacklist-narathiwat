-- Stage 23.16 (pilot): atomic challenge issuance + signed-event storage.
-- Run once in Supabase Studio SQL Editor. Does NOT enable devices, mappings, or ingest.
-- Does not modify any existing heartbeat/Ping function or table.
BEGIN;

-- Serialize issuance per device; avoid races in the 3-pending-challenge limit.
CREATE OR REPLACE FUNCTION public.face_lpr_issue_event_challenge(
    p_device_id uuid,
    p_nonce text
)
RETURNS TABLE(challenge_id uuid, nonce text, expires_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_now timestamptz := transaction_timestamp();
    v_count integer;
    v_id uuid;
    v_expires timestamptz;
BEGIN
    IF p_device_id IS NULL OR p_nonce IS NULL OR p_nonce !~ '^[0-9a-f]{64}$' THEN
        RAISE EXCEPTION 'Invalid challenge request' USING ERRCODE = '22023';
    END IF;

    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_device_id::text, 0));

    -- Lock currently-valid device and permission until transaction ends.
    PERFORM 1
    FROM public.client_devices d
    JOIN public.face_lpr_agent_permissions p ON p.device_id = d.id
    WHERE d.id = p_device_id
      AND d.status = 'active'
      AND d.center_id IS NOT NULL
      AND d.linked_at IS NOT NULL
      AND p.enabled IS TRUE
      AND p.enabled_by IS NOT NULL
      AND p.enabled_at IS NOT NULL
    FOR SHARE OF d, p;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Device not authorized' USING ERRCODE = '42501';
    END IF;

    SELECT count(*)::integer INTO v_count
    FROM public.face_lpr_event_challenges c
    WHERE c.device_id = p_device_id
      AND c.consumed_at IS NULL
      AND c.expires_at > v_now;

    IF v_count >= 3 THEN
        RAISE EXCEPTION 'Challenge rate limit reached' USING ERRCODE = 'P0001';
    END IF;

    INSERT INTO public.face_lpr_event_challenges(device_id, nonce, created_at, expires_at)
    VALUES (p_device_id, p_nonce, v_now, v_now + interval '120 seconds')
    RETURNING id, public.face_lpr_event_challenges.expires_at INTO v_id, v_expires;

    RETURN QUERY SELECT v_id, p_nonce, v_expires;
END;
$$;

REVOKE ALL ON FUNCTION public.face_lpr_issue_event_challenge(uuid,text)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.face_lpr_issue_event_challenge(uuid,text)
TO service_role;

-- This RPC is callable only by service_role from the verified Edge Function.
-- Authentication/signature verification takes place BEFORE calling this RPC.
-- Authorization, one-time consumption, and insertion occur in ONE DB transaction.
CREATE OR REPLACE FUNCTION public.face_lpr_accept_signed_event(
    p_device_id uuid,
    p_challenge_id uuid,
    p_nonce text,
    p_center_id bigint,
    p_nvr_id text,
    p_face_camera_id text,
    p_source_event_key text,
    p_event_time_local timestamp without time zone,
    p_similarity_score numeric
)
RETURNS TABLE(event_id uuid, was_inserted boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_valid_center bigint;
    v_valid_nvr uuid;
    v_challenge uuid;
    v_event_id uuid;
    v_inserted boolean := false;
BEGIN
    IF p_device_id IS NULL OR p_challenge_id IS NULL
       OR p_nonce IS NULL OR p_nonce !~ '^[0-9a-f]{64}$'
       OR p_center_id IS NULL OR p_nvr_id IS NULL OR p_face_camera_id IS NULL
       OR p_source_event_key IS NULL OR p_source_event_key !~ '^[0-9a-f]{64}$'
       OR p_event_time_local IS NULL
       OR p_similarity_score IS NULL OR p_similarity_score < 90 OR p_similarity_score > 100
    THEN
        RAISE EXCEPTION 'Invalid event input' USING ERRCODE = '22023';
    END IF;

    -- All active records must agree. Lock rows to prevent revocation racing this transaction.
    -- Pilot is PRIMARY-only: priority 1 assignment; standby never sends unless explicitly changed.
    SELECT d.center_id, n.id INTO v_valid_center, v_valid_nvr
    FROM public.client_devices d
    JOIN public.face_lpr_agent_permissions p
      ON p.device_id = d.id
    JOIN public.face_lpr_nvrs n
      ON n.center_id = d.center_id
    JOIN public.face_lpr_agent_nvr_assignments a
      ON a.device_id = d.id AND a.nvr_uuid = n.id
    JOIN public.face_lpr_cameras fc
      ON fc.nvr_uuid = n.id
    JOIN public.face_lpr_camera_mappings m
      ON m.nvr_uuid = n.id AND m.face_camera_uuid = fc.id
    JOIN public.face_lpr_cameras lc
      ON lc.nvr_uuid = n.id AND lc.id = m.lpr_camera_uuid
    WHERE d.id = p_device_id
      AND d.status = 'active'
      AND d.linked_at IS NOT NULL
      AND d.center_id = p_center_id
      AND p.enabled IS TRUE
      AND p.enabled_by IS NOT NULL
      AND p.enabled_at IS NOT NULL
      AND n.nvr_id = p_nvr_id
      AND n.is_active IS TRUE
      AND a.is_enabled IS TRUE
      AND a.enabled_by IS NOT NULL
      AND a.enabled_at IS NOT NULL
      AND a.priority = 1
      AND fc.camera_code = p_face_camera_id
      AND fc.camera_role IN ('face', 'both')
      AND fc.is_active IS TRUE
      AND m.is_enabled IS TRUE
      AND m.enabled_by IS NOT NULL
      AND m.enabled_at IS NOT NULL
      AND lc.camera_role IN ('lpr', 'both')
      AND lc.is_active IS TRUE
    LIMIT 1
    FOR SHARE OF d, p, n, a, fc, m, lc;

    IF NOT FOUND OR v_valid_center IS NULL OR v_valid_nvr IS NULL THEN
        RAISE EXCEPTION 'Event not authorized' USING ERRCODE = '42501';
    END IF;

    -- Update on a single row is atomic: concurrent/replayed challenges cannot both succeed.
    UPDATE public.face_lpr_event_challenges c
       SET consumed_at = transaction_timestamp()
     WHERE c.id = p_challenge_id
       AND c.device_id = p_device_id
       AND c.nonce = p_nonce
       AND c.consumed_at IS NULL
       AND c.expires_at > transaction_timestamp()
    RETURNING c.id INTO v_challenge;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Invalid or expired challenge' USING ERRCODE = '42501';
    END IF;

    INSERT INTO public.face_lpr_events(
        center_id, nvr_id, face_camera_id, source_event_key,
        event_time_local, similarity_score, first_reported_by
    ) VALUES (
        v_valid_center, p_nvr_id, p_face_camera_id, p_source_event_key,
        p_event_time_local, p_similarity_score, p_device_id
    )
    ON CONFLICT ON CONSTRAINT face_lpr_event_unique_source DO NOTHING
    RETURNING id INTO v_event_id;

    IF v_event_id IS NOT NULL THEN
        v_inserted := true;
    ELSE
        SELECT e.id INTO v_event_id
        FROM public.face_lpr_events e
        WHERE e.center_id = v_valid_center
          AND e.nvr_id = p_nvr_id
          AND e.source_event_key = p_source_event_key;
    END IF;

    IF v_event_id IS NULL THEN
        RAISE EXCEPTION 'Event storage unavailable' USING ERRCODE = 'P0001';
    END IF;

    RETURN QUERY SELECT v_event_id, v_inserted;
END;
$$;

REVOKE ALL ON FUNCTION public.face_lpr_accept_signed_event(
    uuid,uuid,text,bigint,text,text,text,timestamp without time zone,numeric
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.face_lpr_accept_signed_event(
    uuid,uuid,text,bigint,text,text,text,timestamp without time zone,numeric
) TO service_role;

-- PostgREST loads new RPC metadata without a container restart when listening.
NOTIFY pgrst, 'reload schema';
COMMIT;

-- Read-only verification: both should be present and only service_role may execute.
SELECT
    p.proname AS rpc_name,
    has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_role_execute,
    has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_execute,
    has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_execute
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('face_lpr_issue_event_challenge','face_lpr_accept_signed_event')
ORDER BY p.proname;
