/**
 * apikey.ts
 * -----------------------------------------------------------------------------
 * Per-user API key generation, hashing, and verification.
 *
 * Format:  tp_live_<40 hex chars>
 * Storage: only the SHA-256 hash + a display prefix are stored. The plaintext
 *          is returned to the user exactly once (at creation) and is never
 *          recoverable afterwards.
 * -----------------------------------------------------------------------------
 */
import crypto from "crypto";
import { prisma } from "@/lib/prisma";

const KEY_PREFIX = "tp_live_";
/** Length of the non-secret prefix stored for display (prefix + 8 chars). */
const DISPLAY_LEN = KEY_PREFIX.length + 8;

/** SHA-256 hex digest of a full key. Used for both storage and lookup. */
export function hashKey(fullKey: string): string {
  return crypto.createHash("sha256").update(fullKey).digest("hex");
}

/** Generate a new random key. Returns the plaintext and its derived fields. */
export function generateKey(): {
  fullKey: string;
  keyHash: string;
  prefix: string;
} {
  const random = crypto.randomBytes(20).toString("hex"); // 40 hex chars
  const fullKey = KEY_PREFIX + random;
  return {
    fullKey,
    keyHash: hashKey(fullKey),
    prefix: fullKey.slice(0, DISPLAY_LEN),
  };
}

export interface AuthedKey {
  keyId: string;
  userId: string;
}

/**
 * Look up an API key by its plaintext value. Returns the owning user + key id
 * if valid (exists, not revoked, user not disabled), else null. Also stamps
 * lastUsedAt (best-effort).
 */
export async function verifyKey(fullKey: string): Promise<AuthedKey | null> {
  if (!fullKey || !fullKey.startsWith(KEY_PREFIX)) return null;

  const keyHash = hashKey(fullKey);
  const key = await prisma.apiKey.findUnique({
    where: { keyHash },
    include: { user: { select: { id: true, disabled: true } } },
  });
  if (!key || key.revoked || !key.user || key.user.disabled) return null;

  // Best-effort last-used stamp; don't block the request on it.
  prisma.apiKey
    .update({ where: { id: key.id }, data: { lastUsedAt: new Date() } })
    .catch(() => {});

  return { keyId: key.id, userId: key.user.id };
}

/** Extract a bearer token from an Authorization header. */
export function bearerFromHeader(header: string | null): string | null {
  if (!header) return null;
  const m = header.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}
