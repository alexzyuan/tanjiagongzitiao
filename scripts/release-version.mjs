import { writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const COMMIT_PATTERN = /^[0-9a-f]{40}$/;

export function releaseVersionJson(commit) {
  if (!COMMIT_PATTERN.test(commit)) throw new Error("invalid_release_commit");
  return `${JSON.stringify({ commit })}\n`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [commit, outputPath] = process.argv.slice(2);
  if (!commit || !outputPath)
    throw new Error("usage: node scripts/release-version.mjs <commit> <output-path>");
  await writeFile(outputPath, releaseVersionJson(commit), "utf8");
}
