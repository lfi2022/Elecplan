import './config.js';
import { PrismaClient } from '@prisma/client';
import { mkdir } from 'node:fs/promises';
import { config } from './config.js';
import { acquireLock } from './lock.js';
import { createBackup, restoreBackup } from './backup.js';
await mkdir(config.filesDir,{recursive:true,mode:0o700});
const release=await acquireLock(),db=new PrismaClient();
try {
  if(process.argv[2]==='backup')console.log(JSON.stringify(await createBackup(db)));
  else if(process.argv[2]==='restore' && process.argv[3] && process.argv[4]==='--confirm')console.log(JSON.stringify(await restoreBackup(db,process.argv[3])));
  else throw new Error('Usage : node dist/server/cli.js backup | restore UUID --confirm');
} finally {await db.$disconnect();await release();}
