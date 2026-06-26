import { randomBytes, createHash } from "node:crypto";

export function generateApiKey(): string {
  return `mv_${randomBytes(32).toString("hex")}`;
}

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

const API_KEY_RE = /^mv_[0-9a-f]{64}$/;

// matches the shape generateApiKey mints, so a garbage header gets a 401
// without spending a hash + db lookup on it
export function validateApiKey(key: string): boolean {
  return API_KEY_RE.test(key);
}
