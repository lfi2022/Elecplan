import "../server/config.js";
import { mkdir, open } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { config } from "../server/config.js";
import { acquireLock } from "../server/lock.js";
import { recoverInterruptedRestore } from "../server/backup.js";
await mkdir(config.dataDir, { recursive: true, mode: 0o700 });
const release = await acquireLock();
try {
  await recoverInterruptedRestore();
  await (await open(process.env.DATABASE_URL!.slice(5), "a", 0o600)).close();
  const result = spawnSync(
    process.execPath,
    ["node_modules/prisma/build/index.js", "migrate", "deploy"],
    { stdio: "inherit", env: process.env },
  );
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  await release();
}
