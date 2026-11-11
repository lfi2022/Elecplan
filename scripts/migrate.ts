import '../server/config.js';
import { mkdir, open } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { config } from '../server/config.js';
await mkdir(config.dataDir,{recursive:true,mode:0o700});
await (await open(process.env.DATABASE_URL!.slice(5),'a',0o600)).close();
const result=spawnSync(process.execPath,['node_modules/prisma/build/index.js','migrate','deploy'],{stdio:'inherit',env:process.env});
process.exitCode=result.status||0;
