import { createHmac, timingSafeEqual } from "node:crypto";
import type { DingTalkIdentity } from "@salary/dingtalk";

export interface SessionIdentity extends DingTalkIdentity { issuedAt: number; }

export const SESSION_MAX_AGE_MS = 8 * 60 * 60 * 1000;

export class SessionService {
  constructor(private readonly signingKey: string) {}

  create(identity: DingTalkIdentity): string {
    const payload = Buffer.from(JSON.stringify({ ...identity, issuedAt: Date.now() })).toString("base64url");
    return `${payload}.${this.sign(payload)}`;
  }

  read(token: string | undefined): SessionIdentity {
    if (!token) throw new Error("session_missing");
    const [payload, signature] = token.split(".");
    if (!payload || !signature) throw new Error("session_malformed");
    const expected = this.sign(payload);
    if (signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) throw new Error("session_signature_invalid");
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as SessionIdentity;
    if (
      !decoded.userId ||
      !decoded.corpId ||
      !decoded.name ||
      !Number.isSafeInteger(decoded.issuedAt) ||
      decoded.issuedAt <= 0
    )
      throw new Error("session_payload_invalid");
    const age = Date.now() - decoded.issuedAt;
    if (age < 0 || age > SESSION_MAX_AGE_MS)
      throw new Error("session_expired");
    return decoded;
  }

  private sign(payload: string): string { return createHmac("sha256", this.signingKey).update(payload).digest("base64url"); }
}
