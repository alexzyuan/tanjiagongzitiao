#!/usr/bin/env node
import { scanArchitecture } from "./architecture-rules.mjs";

const result = await scanArchitecture();
for (const warning of result.warnings) console.warn(warning);
for (const error of result.errors) console.error(error);
if (result.errors.length > 0) process.exitCode = 1;
else console.log("ARCH-OK");
