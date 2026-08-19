import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { scanArchitecture } from "./architecture-rules.mjs";

async function fixture() {
  return mkdtemp(join(tmpdir(), "salary-architecture-"));
}

async function writeFixture(root, relativePath, content) {
  const file = join(root, relativePath);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, content);
}

describe("architecture rules", () => {
  it("finds banned dependencies", async () => {
    const root = await fixture();
    await writeFixture(root, "package.json", JSON.stringify({ dependencies: { redis: "1.0.0" } }));
    const result = await scanArchitecture(root);
    assert.equal(result.errors.some((error) => error.includes("redis")), true);
  });

  it("finds forbidden dependency directions", async () => {
    const root = await fixture();
    await writeFixture(root, "package.json", "{}");
    await writeFixture(root, "packages/domain/src/index.ts", 'import db from "@salary/db";\n');
    await writeFixture(root, "apps/web/src/index.ts", 'import db from "@salary/db";\n');
    const result = await scanArchitecture(root);
    assert.equal(result.errors.some((error) => error.includes("packages/domain")), true);
    assert.equal(result.errors.some((error) => error.includes("apps/web")), true);
  });

  it("reports size warnings without hard failure", async () => {
    const root = await fixture();
    await writeFixture(root, "package.json", "{}");
    await writeFixture(root, "apps/web/src/App.tsx", `${"x\n".repeat(501)}`);
    const result = await scanArchitecture(root);
    assert.deepEqual(result.errors, []);
    assert.equal(result.warnings.some((warning) => warning.includes("App.tsx")), true);
  });

  it("passes a legal structure", async () => {
    const root = await fixture();
    await writeFixture(root, "package.json", "{}");
    await writeFixture(root, "packages/domain/src/index.ts", 'export const ok = true;\n');
    assert.deepEqual(await scanArchitecture(root), { errors: [], warnings: [] });
  });
});
