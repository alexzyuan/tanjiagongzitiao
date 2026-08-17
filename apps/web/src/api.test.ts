import { describe, expect, it } from "vitest";
import { extractDingTalkAuthCode } from "./api";

describe("DingTalk auth code parsing", () => {
  it("prefers authCode over a JSAPI status code", () => {
    expect(extractDingTalkAuthCode({ code: "0", authCode: "real-auth-code" })).toBe("real-auth-code");
  });

  it("does not treat a zero status code as an auth code", () => {
    expect(extractDingTalkAuthCode({ code: 0 })).toBe("");
  });
});
