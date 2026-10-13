// Keeps web/src/database.types.ts in step with the database schema.
//   node scripts/db-types.mjs          check: exit 1 if the committed file differs from the local DB
//   node scripts/db-types.mjs --write  regenerate the file
// Needs the local stack running with all migrations applied (`npm run db:reset`).
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const FILE = "web/src/database.types.ts";
const normalize = (s) => s.replace(/\r\n/g, "\n").trimEnd() + "\n";

// Run the project's Supabase CLI through node (no shell, works the same on Windows and Linux).
const require = createRequire(import.meta.url);
const pkg = require.resolve("supabase/package.json");
const cli = path.join(path.dirname(pkg), require(pkg).bin.supabase);

const generated = normalize(execFileSync(process.execPath, [cli, "gen", "types", "typescript", "--local", "--schema", "public"], {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "inherit"],
}));

if (process.argv.includes("--write")) {
  writeFileSync(FILE, generated);
  console.log(`Wrote ${FILE}`);
} else if (normalize(readFileSync(FILE, "utf8")) !== generated) {
  console.error(`${FILE} is out of date with the database schema. Run: npm run db:types`);
  process.exit(1);
} else {
  console.log(`${FILE} matches the database schema.`);
}
