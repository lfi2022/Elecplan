import { buildApp } from "./app.js";
import { config } from "./config.js";
import { mkdir } from "node:fs/promises";
import { acquireLock } from "./lock.js";
import { recoverInterruptedRestore } from "./backup.js";
await mkdir(config.dataDir, { recursive: true, mode: 0o700 });
const release = await acquireLock();
await recoverInterruptedRestore();
const app = await buildApp();
app.addHook("onClose", release);
await app.listen({ host: config.host, port: config.port });
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    void app.close();
  });
