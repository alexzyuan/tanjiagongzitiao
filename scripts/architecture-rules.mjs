import { readFile, readdir } from "node:fs/promises";
import { basename, dirname, relative, resolve } from "node:path";

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".mjs"]);
const IGNORED_DIRS = new Set([".git", ".superpowers", "dist", "node_modules", "coverage"]);
const BANNED_DEPENDENCIES = new Set([
  "prisma",
  "@prisma/client",
  "typeorm",
  "sequelize",
  "redis",
  "ioredis",
  "bullmq",
  "amqplib",
  "kafkajs",
  "redux",
  "@reduxjs/toolkit",
  "@tanstack/react-query",
  "@tanstack/react-router",
  "react-router",
  "react-router-dom",
  "tailwindcss",
  "styled-components",
]);

const IMPORT_RULES = [
  ["packages/domain", ["@salary/db", "@salary/dingtalk", "apps/", "fastify", "react", "better-sqlite3"]],
  ["packages/db", ["apps/", "@salary/dingtalk", "fastify", "react"]],
  ["packages/dingtalk", ["apps/", "@salary/db", "fastify", "react"]],
  ["apps/web", ["@salary/db", "@salary/dingtalk", "apps/api", "better-sqlite3", "node:fs", "node:path"]],
  ["apps/worker", ["@salary/dingtalk", "fastify", "react", "apps/api", "apps/web"]],
];

const EXPECTED_CSS_DUPLICATES = [
  {
    selector: "body",
    locations: ["apps/web/src/styles/base.css", "apps/web/src/styles/salary.css"],
    reason: "salary print mode switches the document canvas to white",
  },
  {
    selector: ".sidebar",
    locations: ["apps/web/src/styles/base.css", "apps/web/src/styles/salary.css"],
    reason: "salary print mode hides application navigation",
  },
  {
    selector: ".main-content",
    locations: ["apps/web/src/styles/base.css", "apps/web/src/styles/salary.css"],
    reason: "salary print mode removes application padding",
  },
  {
    selector: ".topbar",
    locations: ["apps/web/src/styles/base.css", "apps/web/src/styles/salary.css"],
    reason: "salary print mode hides the application header",
  },
  {
    selector: ".page-wrap",
    locations: ["apps/web/src/styles/base.css", "apps/web/src/styles/salary.css"],
    reason: "salary print mode removes page chrome padding",
  },
];

export async function scanArchitecture(root = process.cwd()) {
  const absoluteRoot = resolve(root);
  const files = await filesUnder(absoluteRoot);
  const errors = [];
  const warnings = [];

  await checkDependencies(absoluteRoot, files, errors);
  await checkImportDirections(absoluteRoot, files, errors);
  await checkInfrastructureManifests(absoluteRoot, files, errors);
  await checkSizeWarnings(absoluteRoot, files, warnings);
  await checkDuplicateSelectors(absoluteRoot, files, warnings);

  return { errors: [...new Set(errors)], warnings: [...new Set(warnings)] };
}

async function filesUnder(root) {
  const result = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isDirectory() && IGNORED_DIRS.has(entry.name)) continue;
      const file = resolve(directory, entry.name);
      if (entry.isDirectory()) await visit(file);
      else result.push(file);
    }
  }
  await visit(root);
  return result;
}

async function checkDependencies(root, files, errors) {
  for (const file of files.filter((candidate) => basename(candidate) === "package.json")) {
    let manifest;
    try {
      manifest = JSON.parse(await readFile(file, "utf8"));
    } catch (error) {
      errors.push(`ARCH-ERROR invalid package manifest ${display(root, file)}: ${error.message}`);
      continue;
    }
    for (const section of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]) {
      for (const dependency of Object.keys(manifest[section] ?? {})) {
        if (BANNED_DEPENDENCIES.has(dependency))
          errors.push(`ARCH-ERROR banned dependency ${dependency} in ${display(root, file)}`);
      }
    }
  }
}

async function checkImportDirections(root, files, errors) {
  const sourceFiles = files.filter((file) => SOURCE_EXTENSIONS.has(extname(file)));
  for (const [directory, forbidden] of IMPORT_RULES) {
    for (const file of sourceFiles) {
      const relativeFile = display(root, file);
      if (!(relativeFile === directory || relativeFile.startsWith(`${directory}/`))) continue;
      const source = await readFile(file, "utf8");
      for (const specifier of importsFrom(source)) {
        const blocked = forbidden.find(
          (prefix) =>
            specifier === prefix ||
            specifier.startsWith(prefix) ||
            resolvedTargetMatches(root, file, specifier, prefix),
        );
        if (blocked)
          errors.push(`ARCH-ERROR forbidden import ${specifier} in ${relativeFile} (rule ${directory})`);
      }
    }
  }
  for (const file of sourceFiles) {
    const relativeFile = display(root, file);
    if (!relativeFile.startsWith("packages/")) continue;
    for (const specifier of importsFrom(await readFile(file, "utf8"))) {
      if (
        specifier === "apps" ||
        specifier.startsWith("apps/") ||
        resolvedTargetMatches(root, file, specifier, "apps/")
      )
        errors.push(`ARCH-ERROR forbidden import ${specifier} in ${relativeFile} (rule packages/**)`);
    }
  }
}

async function checkInfrastructureManifests(root, files, errors) {
  for (const file of files.filter((candidate) => ["docker-compose.yml", "compose.yaml"].includes(basename(candidate)))) {
    const source = await readFile(file, "utf8");
    for (const service of ["postgres", "mysql", "redis", "rabbitmq", "kafka"]) {
      if (new RegExp(`\\b${service}\\b`, "i").test(source))
        errors.push(`ARCH-ERROR forbidden infrastructure ${service} in ${display(root, file)}`);
    }
  }
}

async function checkSizeWarnings(root, files, warnings) {
  for (const file of files) {
    const lines = (await readFile(file, "utf8")).split(/\r?\n/).length;
    const relativeFile = display(root, file);
    const name = basename(file);
    let limit;
    if (relativeFile === "apps/web/src/App.tsx") limit = 500;
    else if (relativeFile.startsWith("apps/web/") && name.endsWith(".tsx") && /(?:pages|features)\//.test(relativeFile)) limit = 400;
    else if (relativeFile.startsWith("apps/api/") && name.endsWith("service.ts")) limit = 600;
    else if (relativeFile.startsWith("apps/api/") && name.endsWith("routes.ts")) limit = 400;
    else if (relativeFile.startsWith("packages/db/") && name === "store.ts") limit = 700;
    else if (name.endsWith(".css")) limit = 650;
    if (limit && lines > limit) warnings.push(`ARCH-WARN file_size ${relativeFile} ${lines} > ${limit}`);
  }
}

async function checkDuplicateSelectors(root, files, warnings) {
  const selectors = new Map();
  for (const file of files.filter((candidate) => candidate.endsWith(".css"))) {
    const source = (await readFile(file, "utf8")).replace(/\/\*[\s\S]*?\*\//g, "");
    for (const match of source.matchAll(/([^{}]+)\{/g)) {
      for (const selector of match[1].split(",").map((item) => item.trim().replace(/\s+/g, " "))) {
        if (!selector || selector.startsWith("@") || selector === ":root" || selector.includes("@")) continue;
        const locations = selectors.get(selector) ?? new Set();
        locations.add(display(root, file));
        selectors.set(selector, locations);
      }
    }
  }
  for (const [selector, locations] of selectors) {
    if (locations.size > 1 && !isExpectedDuplicate(selector, [...locations]))
      warnings.push(`ARCH-WARN duplicate_selector ${selector}\n  ${[...locations].join("\n  ")}`);
  }
}

export function isExpectedDuplicate(selector, locations) {
  const normalizedLocations = [...locations].sort();
  return EXPECTED_CSS_DUPLICATES.some(
    (entry) =>
      entry.selector === selector &&
      entry.locations.length === normalizedLocations.length &&
      entry.locations.every((location, index) => location === normalizedLocations[index]),
  );
}

function importsFrom(source) {
  const specifiers = [];
  const pattern = /(?:\bfrom\s*|\bimport\s*(?:\(\s*)?|\brequire\s*\()(["'])([^"']+)\1/g;
  for (const match of source.matchAll(pattern)) specifiers.push(match[2]);
  return specifiers;
}

function resolvedTargetMatches(root, sourceFile, specifier, forbiddenPrefix) {
  if (!specifier.startsWith(".")) return false;
  const target = resolve(dirname(sourceFile), specifier);
  const targetRelative = display(root, target);
  if (targetRelative === "" || targetRelative === ".." || targetRelative.startsWith("../")) return false;
  if (forbiddenPrefix === "apps/") return targetRelative.startsWith("apps/");
  if (forbiddenPrefix === "@salary/db") return targetRelative.startsWith("packages/db/");
  if (forbiddenPrefix === "@salary/dingtalk") return targetRelative.startsWith("packages/dingtalk/");
  if (forbiddenPrefix === "apps/api") return targetRelative.startsWith("apps/api/");
  if (forbiddenPrefix === "apps/web") return targetRelative.startsWith("apps/web/");
  return false;
}

function extname(file) {
  const index = file.lastIndexOf(".");
  return index < 0 ? "" : file.slice(index);
}

function display(root, file) {
  return relative(root, file).split("\\").join("/");
}
