-- Stage 23.19: signed challenge request nonce replay guard + atomic issuance.
-- Run once in Supabase Studio after offline verifier passes.
-- Event ingestion remains disabled, no NVR or existing heartbeat changes.
BEGIN;

CREATE TABLE public.face_lpr_challenge_request_nonces (
    device_id uuid NOT NULL REFERENCES public.client_devices(id) ON DELETE CASCADE,
    request_nonce text NOT NULL CHECK (request_nonce ~ '^[0-9a-f]{64}$'),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (device_id, request_nonce)
);
CREATE INDEX face_lpr_challenge_request_nonces_created_idx
    ON public.face_lpr_challenge_request_nonces (created_at);
ALTER TABLE public.face_lpr_challenge_request_nonces ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.face_lpr_challenge_request_nonces FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.face_lpr_challenge_request_nonces TO service_role;

-- Only call after verifying the signed request using the registered device's Ed25519 key.
CREATE FUNCTION public.face_lpr_issue_authenticated_event_challenge(
    p_device_id uuid,
    p_event_nonce text,
    p_request_nonce text,
    p_issued_at timestamptz
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
    v_exp timestamptz;
BEGIN
    IF p_device_id IS NULL OR p_event_nonce !~ '^[0-9a-f]{64}$'
       OR p_event_nonce IS NULL OR p_request_nonce IS NULL
       OR p_request_nonce !~ '^[0-9a-f]{64}$' OR p_issued_at IS NULL
       OR p_issued_at NOT BETWEEN
            v_now - INTERVAL '90 seconds'
            AND v_now + INTERVAL '90 seconds' THEN
        RAISE EXCEPTION 'Invalid signed challenge' USING ERRCODE = '22023';
    END IF;

    -- Serialize per-device so concurrent issuance cannot evade pending limit.
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_device_id::text, 0));

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

    -- One-time request nonce: atomic uniqueness prevents replay for this device.
    INSERT INTO public.face_lpr_challenge_request_nonces(device_id, request_nonce, created_at)
    VALUES (p_device_id, p_request_nonce, v_now)
    ON CONFLICT DO NOTHING;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Duplicate signed challenge request' USING ERRCODE = '42501';
    END IF;

    INSERT INTO public.face_lpr_event_challenges(device_id, nonce, created_at, expires_at)
    VALUES (p_device_id, p_event_nonce, v_now, v_now + interval '120 seconds')
    RETURNING id, public.face_lpr_event_challenges.expires_at INTO v_id, v_exp;

    RETURN QUERY SELECT v_id, p_event_nonce, v_exp;
END;
$$;

REVOKE ALL ON FUNCTION public.face_lpr_issue_authenticated_event_challenge(uuid,text,text,timestamptz)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.face_lpr_issue_authenticated_event_challenge(uuid,text,text,timestamptz)
TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;

SELECT
  p.proname,
  has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_can_execute,
  has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_can_execute,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_can_execute,
  (SELECT count(*) FROM public.face_lpr_challenge_request_nonces) AS request_nonce_rows
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
AND p.proname = 'face_lpr_issue_authenticated_event_challenge';
