import { describe, expect, it } from "vitest";
import { decryptSalaryPayload, encryptSalaryPayload, fingerprintSalaryPayload } from "../src/crypto.js";

const key = Buffer.alloc(32, 7);

describe("salary encryption", () => {
  it("encrypts without retaining plaintext", () => {
    const encrypted = encryptSalaryPayload({ basicSalary: 12000 }, key);
    expect(encrypted.ciphertext.toString("utf8")).not.toContain("12000");
    expect(decryptSalaryPayload(encrypted, key)).toEqual({ basicSalary: 12000 });
  });

  it("generates stable fingerprints for evidence", () => {
    expect(fingerprintSalaryPayload({ basicSalary: 12000 })).toBe(fingerprintSalaryPayload({ basicSalary: 12000 }));
  });
});
