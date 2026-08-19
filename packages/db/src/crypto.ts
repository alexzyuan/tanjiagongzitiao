import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export interface EncryptedPayload {
  ciphertext: Buffer;
  iv: Buffer;
  authTag: Buffer;
}

function resolveKey(key?: Buffer): Buffer {
  const resolved = key ?? (() => {
    const value = process.env.SALARY_ENCRYPTION_KEY;
    if (!value) throw new Error("salary_encryption_key_missing");
    return Buffer.from(value, "hex");
  })();
  if (resolved.length !== 32) throw new Error("salary_encryption_key_must_be_32_bytes");
  return resolved;
}

export function encryptSalaryPayload(payload: Record<string, unknown>, key?: Buffer): EncryptedPayload {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", resolveKey(key), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  return { ciphertext, iv, authTag: cipher.getAuthTag() };
}

export function decryptSalaryPayload(encrypted: EncryptedPayload, key?: Buffer): Record<string, unknown> {
  const decipher = createDecipheriv("aes-256-gcm", resolveKey(key), encrypted.iv);
  decipher.setAuthTag(encrypted.authTag);
  return JSON.parse(Buffer.concat([decipher.update(encrypted.ciphertext), decipher.final()]).toString("utf8")) as Record<string, unknown>;
}

export function fingerprintSalaryPayload(payload: Record<string, unknown>): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}
