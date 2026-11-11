import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
const dir = await mkdtemp(path.join(os.tmpdir(), "electroplan-e2e-"));
process.env.DATA_DIR = dir;
process.env.DATABASE_URL = `file:${path.join(dir, "electroplan.db").replaceAll("\\", "/")}`;
process.env.SETUP_TOKEN = "e2e-setup-token-of-at-least-24-characters";
process.env.PUBLIC_URL = "http://localhost:3107";
process.env.PORT = "3107";
process.env.HOST = "127.0.0.1";
const result = spawnSync(
  process.execPath,
  ["node_modules/tsx/dist/cli.mjs", "scripts/migrate.ts"],
  { stdio: "inherit", env: process.env },
);
if (result.status) process.exit(result.status);
await import("../server/index.js");
