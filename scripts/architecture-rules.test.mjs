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

  it("resolves forbidden relative imports inside the repository", async () => {
    const root = await fixture();
    await writeFixture(root, "package.json", "{}");
    await writeFixture(root, "packages/db/src/index.ts", "export const db = true;\n");
    await writeFixture(root, "apps/api/src/index.ts", "export const api = true;\n");
    await writeFixture(root, "packages/domain/src/index.ts", 'import "../../db/src/index.js";\nimport "../../../apps/api/src/index.js";\n');
    await writeFixture(root, "apps/web/src/index.ts", 'import "../../../packages/db/src/index.js";\n');
    const result = await scanArchitecture(root);
    assert.equal(result.errors.some((error) => error.includes("../../db/src/index.js")), true);
    assert.equal(result.errors.some((error) => error.includes("../../../apps/api/src/index.js")), true);
    assert.equal(result.errors.some((error) => error.includes("../../../packages/db/src/index.js")), true);
  });

  it("finds dynamic imports and allows same-package relative imports", async () => {
    const root = await fixture();
    await writeFixture(root, "package.json", "{}");
    await writeFixture(root, "packages/db/src/index.ts", "export const db = true;\n");
    await writeFixture(root, "packages/domain/src/helper.ts", "export const helper = true;\n");
    await writeFixture(root, "packages/domain/src/index.ts", 'import "./helper.js";\nawait import("@salary/db");\n');
    const result = await scanArchitecture(root);
    assert.equal(result.errors.some((error) => error.includes("@salary/db")), true);
    assert.equal(result.errors.some((error) => error.includes("./helper.js")), false);
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
