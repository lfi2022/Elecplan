import { cp, mkdir, readFile, writeFile, readdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { config } from './config.js';
import { digest } from './security.js';
export function backupPath(id: string) {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw Object.assign(new Error('Identifiant de sauvegarde invalide.'), { statusCode: 400 });
  return path.join(config.backupsDir, id);
}
export async function createBackup(db: PrismaClient) {
  const id = randomUUID(), dir = backupPath(id);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  try {
    const snapshot = path.join(dir, 'electroplan.db').replaceAll('\\', '/').replaceAll("'", "''");
    await db.$executeRawUnsafe(`VACUUM INTO '${snapshot}'`);
    await cp(config.filesDir, path.join(dir, 'files'), { recursive: true });
    const hashes: Record<string,string> = { 'electroplan.db': digest(await readFile(path.join(dir, 'electroplan.db'))) };
    for (const key of await readdir(path.join(dir, 'files'))) hashes[`files/${key}`] = digest(await readFile(path.join(dir, 'files', key)));
    await writeFile(path.join(dir, 'manifest.json'), JSON.stringify({ format: 1, createdAt: new Date().toISOString(), hashes }, null, 2), { mode: 0o600 });
    return { id, files: Object.keys(hashes).length - 1 };
  } catch (error) { await rm(dir, { recursive: true, force: true }); throw error; }
}
export async function listBackups() {
  await mkdir(config.backupsDir, { recursive: true, mode: 0o700 });
  const results = [];
  for (const id of await readdir(config.backupsDir)) {
    if (!/^[a-f0-9-]{36}$/.test(id)) continue;
    try { const manifest = JSON.parse(await readFile(path.join(backupPath(id), 'manifest.json'), 'utf8')); results.push({ id, createdAt: manifest.createdAt, files: Object.keys(manifest.hashes).length - 1 }); } catch { /* incomplete backups are not restorable */ }
  }
  return results.sort((a,b) => b.createdAt.localeCompare(a.createdAt));
}
export async function restoreBackup(db: PrismaClient, id: string) {
  const dir = backupPath(id), manifest = JSON.parse(await readFile(path.join(dir, 'manifest.json'), 'utf8'));
  if (manifest.format !== 1 || !manifest.hashes?.['electroplan.db']) throw new Error('Manifeste invalide.');
  for (const [key, hash] of Object.entries(manifest.hashes)) {
    if (key !== 'electroplan.db' && !/^files\/[a-f0-9-]{36}$/.test(key)) throw new Error('Chemin de sauvegarde invalide.');
    const source = path.join(dir, key);
    if (!(await stat(source)).isFile() || digest(await readFile(source)) !== hash) throw new Error(`Sauvegarde altérée : ${key}`);
  }
  const sourceDb = new PrismaClient({ datasourceUrl: `file:${path.join(dir,'electroplan.db').replaceAll('\\','/')}` });
  try {
    const integrity = await sourceDb.$queryRawUnsafe<Array<{ integrity_check: string }>>('PRAGMA integrity_check');
    if (integrity[0]?.integrity_check !== 'ok') throw new Error('Base SQLite corrompue.');
    const currentMigrations = await db.$queryRawUnsafe<Array<{ migration_name: string }>>('SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY migration_name');
    const sourceMigrations = await sourceDb.$queryRawUnsafe<Array<{ migration_name: string }>>('SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY migration_name');
    if (JSON.stringify(currentMigrations) !== JSON.stringify(sourceMigrations)) throw new Error('Versions de schéma différentes : restaurer avec la version applicative correspondante.');
    for (const version of await sourceDb.version.findMany()) if (!manifest.hashes[`files/${version.storageKey}`]) throw new Error('Document absent de la sauvegarde.');
  } finally { await sourceDb.$disconnect(); }
  const databasePath = process.env.DATABASE_URL!.slice(5);
  if (!path.isAbsolute(databasePath)) throw new Error('La restauration exige une DATABASE_URL absolue.');
  const rollback = path.join(config.dataDir, `rollback-${randomUUID()}`);
  await mkdir(rollback, { mode: 0o700 });
  await db.$disconnect();
  try {
    await cp(databasePath, path.join(rollback, 'electroplan.db'));
    await cp(config.filesDir, path.join(rollback, 'files'), { recursive: true });
    for (const suffix of ['-wal', '-shm', '-journal']) await rm(databasePath + suffix, { force: true });
    await cp(path.join(dir, 'electroplan.db'), databasePath);
    await rename(config.filesDir, path.join(rollback, 'old-files'));
    await mkdir(config.filesDir, { mode: 0o700 });
    for (const key of Object.keys(manifest.hashes)) if (key.startsWith('files/')) await cp(path.join(dir,key), path.join(config.filesDir,path.basename(key)));
    await db.$connect();
    await db.session.deleteMany();
  } catch (error) {
    await db.$disconnect();
    await cp(path.join(rollback,'electroplan.db'), databasePath);
    await rm(config.filesDir, { recursive: true, force: true });
    await cp(path.join(rollback, 'files'), config.filesDir, { recursive: true });
    await db.$connect();
    throw error;
  }
  // Kept deliberately: operator can inspect this extra pre-restore recovery copy.
  return { restored: true, recovery: path.basename(rollback) };
}
