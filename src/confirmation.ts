/**
 * Two-step confirmation for destructive operations.
 *
 * The first call to a destructive tool returns a token derived from the exact
 * operation being requested. The second call must echo that token back. A
 * token therefore authorizes one specific operation and nothing else —
 * approving a delete of `memory/a.md` cannot be replayed to delete
 * `memory/b.md`.
 *
 * Tokens are derived rather than stored, so no state is needed. They are
 * salted with COOKIE_ENCRYPTION_KEY so a caller cannot compute one offline,
 * and bucketed by time so a token goes stale instead of lasting forever.
 */

const TOKEN_LIFETIME_MS = 10 * 60 * 1000;

/** Bucket index for a moment in time, so tokens survive ~10-20 minutes. */
function timeBucket(now: number): number {
  return Math.floor(now / TOKEN_LIFETIME_MS);
}

async function derive(
  secret: string,
  operation: string,
  bucket: number,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${bucket}:${operation}`),
  );
  return [...new Uint8Array(signature)]
    .slice(0, 8)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Token for an operation, valid for the current time bucket. Callers pass a
 * canonical description of the operation — same description, same token.
 */
export async function confirmationToken(
  secret: string,
  operation: string,
  now: number,
): Promise<string> {
  return derive(secret, operation, timeBucket(now));
}

/**
 * True when `provided` matches the token for this operation, accepting the
 * previous bucket too so a confirmation near a boundary still works.
 */
export async function isValidConfirmation(
  secret: string,
  operation: string,
  provided: string,
  now: number,
): Promise<boolean> {
  const bucket = timeBucket(now);
  const candidates = await Promise.all([
    derive(secret, operation, bucket),
    derive(secret, operation, bucket - 1),
  ]);
  return candidates.some((candidate) => timingSafeEqual(candidate, provided));
}

function timingSafeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) {
    return false;
  }
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}
