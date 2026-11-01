// Pure validation helpers. No database, network or Deno dependencies.
export const CHALLENGE_TTL_SECONDS = 120;
export const MAX_PENDING_CHALLENGES = 3;
export const MAX_REQUEST_BYTES = 2048;
export const UUID_PATTERN = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

export class RequestError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = 'RequestError';
  }
}

export function parseChallengeDeviceId(value: unknown): string {
  if (
    !value || typeof value !== 'object' || Array.isArray(value) ||
    Object.keys(value).sort().join(',') !== 'action,deviceId'
  ) {
    throw new RequestError(400, 'Invalid request');
  }
  const body = value as Record<string, unknown>;
  if (body.action !== 'challenge' || typeof body.deviceId !== 'string' ||
    !UUID_PATTERN.test(body.deviceId)) {
    throw new RequestError(400, 'Invalid request');
  }
  return body.deviceId.toLowerCase();
}

export type DeviceRow = {
  id?: string;
  status?: string | null;
  center_id?: number | null;
  linked_at?: string | null;
};
export type PermissionRow = {
  enabled?: boolean | null;
  enabled_by?: string | null;
  enabled_at?: string | null;
};

export function isAllowedForChallenge(
  device: DeviceRow | null | undefined,
  permission: PermissionRow | null | undefined,
): boolean {
  return !!device && device.status === 'active' &&
    Number.isSafeInteger(device.center_id) && Number(device.center_id) > 0 &&
    typeof device.linked_at === 'string' && device.linked_at.length > 0 &&
    permission?.enabled === true &&
    typeof permission.enabled_by === 'string' && permission.enabled_by.length > 0 &&
    typeof permission.enabled_at === 'string' && permission.enabled_at.length > 0;
}

export function generateNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, n => n.toString(16).padStart(2, '0')).join('');
}

export function challengeTimes(now: number): { created_at: string; expires_at: string } {
  if (!Number.isFinite(now)) throw new RequestError(503, 'Clock unavailable');
  return {
    created_at: new Date(now).toISOString(),
    expires_at: new Date(now + CHALLENGE_TTL_SECONDS * 1000).toISOString(),
  };
}
