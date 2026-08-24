import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { releaseVersionJson } from "./release-version.mjs";

describe("release version metadata", () => {
  it("exposes only the deployed commit in stable JSON", () => {
    assert.equal(
      releaseVersionJson("563ef139ad366e20935f35c19bde3a286fa90c15"),
      '{"commit":"563ef139ad366e20935f35c19bde3a286fa90c15"}\n',
    );
  });
});
