import { open, readFile, unlink } from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";
export async function acquireLock() {
  const file = path.join(config.dataDir, "service.lock");
  try {
    const handle = await open(file, "wx", 0o600);
    await handle.writeFile(String(process.pid));
    await handle.close();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const pid = Number(await readFile(file, "utf8"));
    let alive = true;
    try {
      process.kill(pid, 0);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ESRCH") alive = false;
    }
    if (alive || !pid)
      throw new Error(
        "ElectroPlan fonctionne déjà. Arrêtez le service avant une opération CLI hors ligne.",
      );
    await unlink(file);
    return acquireLock();
  }
  return async () => {
    await unlink(file).catch(() => {});
  };
}
