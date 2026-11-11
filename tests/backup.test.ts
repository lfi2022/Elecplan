import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, cp, writeFile, readFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
test("sauvegarde altérée refusée, verrou exclusif et reprise après interruption", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "ep-recovery-"));
  process.env.DATA_DIR = dir;
  process.env.DATABASE_URL = `file:${path.join(dir, "electroplan.db").replaceAll("\\", "/")}`;
  const result = spawnSync(
    process.execPath,
    ["node_modules/tsx/dist/cli.mjs", "scripts/migrate.ts"],
    { env: process.env, encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const { PrismaClient } = await import("@prisma/client");
  const { createBackup, restoreBackup, recoverInterruptedRestore } =
    await import("../server/backup.js");
  const { acquireLock } = await import("../server/lock.js");
  const db = new PrismaClient();
  await mkdir(path.join(dir, "files"));
  try {
    await db.setting.create({ data: { key: "check", value: "original" } });
    const backup = await createBackup(db);
    await writeFile(
      path.join(dir, "backups", backup.id, "electroplan.db"),
      "tampered",
    );
    await assert.rejects(restoreBackup(db, backup.id), /altérée/);
    assert.equal(
      (await db.setting.findUniqueOrThrow({ where: { key: "check" } })).value,
      "original",
    );
    const release = await acquireLock();
    await assert.rejects(acquireLock(), /déjà/);
    await release();
    await db.$disconnect();
    const rollback = `rollback-${randomUUID()}`;
    await mkdir(path.join(dir, rollback));
    await cp(
      path.join(dir, "electroplan.db"),
      path.join(dir, rollback, "electroplan.db"),
    );
    await cp(path.join(dir, "files"), path.join(dir, rollback, "files"), {
      recursive: true,
    });
    await db.setting.update({
      where: { key: "check" },
      data: { value: "incomplete restore" },
    });
    await db.$disconnect();
    await writeFile(
      path.join(dir, "restore-pending.json"),
      JSON.stringify({
        rollback,
        databasePath: process.env.DATABASE_URL.slice(5),
      }),
    );
    await recoverInterruptedRestore();
    assert.equal(
      (await db.setting.findUniqueOrThrow({ where: { key: "check" } })).value,
      "original",
    );
    await assert.rejects(readFile(path.join(dir, "restore-pending.json")));
  } finally {
    await db.$disconnect();
    await rm(dir, { recursive: true, force: true });
  }
});
