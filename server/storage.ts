import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { config } from './config.js';
import { digest } from './security.js';
export async function storeFile(filename: string, bytes: Buffer) {
  const ext = path.extname(filename).toLowerCase();
  const signatures: Record<string, () => boolean> = {
    '.pdf': () => bytes.subarray(0, 5).toString() === '%PDF-',
    '.png': () => bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])),
    '.jpg': () => bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255,
    '.jpeg': () => bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255,
    '.dwg': () => /^AC10\d{2}/.test(bytes.subarray(0,6).toString()),
    '.dxf': () => /SECTION/.test(bytes.subarray(0,1024).toString()) || bytes.subarray(0,18).toString().startsWith('AutoCAD Binary DXF'),
  };
  if (!signatures[ext]?.() || bytes.length > config.maxFile) throw Object.assign(new Error('Format ou signature du fichier invalide (PDF, PNG, JPEG, DWG, DXF ; 50 Mo maximum).'), { statusCode: 400 });
  const mime = ({ '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' } as Record<string,string>)[ext] || 'application/octet-stream';
  let text = '';
  if (ext === '.pdf') {
    try { text = await extractPdf(bytes); }
    catch { throw Object.assign(new Error('PDF illisible ou chiffré. Fournissez un PDF lisible.'), { statusCode: 400 }); }
  }
  await mkdir(config.filesDir, { recursive: true, mode: 0o700 });
  const storageKey = randomUUID();
  await writeFile(path.join(config.filesDir, storageKey), bytes, { flag: 'wx', mode: 0o600 });
  return { storageKey, mime, size: bytes.length, sha256: digest(bytes), text, originalName: path.basename(filename).replace(/[\r\n\x00-\x1f]/g, '').slice(0,200) };
}
export const removeFile = (key: string) => unlink(path.join(config.filesDir, key)).catch(() => {});
function extractPdf(bytes: Buffer): Promise<string> {
  return new Promise((resolve,reject) => {
    const worker = new Worker(`const {parentPort,workerData}=require('node:worker_threads'); require('pdf-parse/lib/pdf-parse.js')(Buffer.from(workerData),{max:1000}).then(r=>parentPort.postMessage(r.text.slice(0,2000000))).catch(e=>{throw e});`,{eval:true,workerData:bytes,resourceLimits:{maxOldGenerationSizeMb:128}});
    const timer=setTimeout(()=>{void worker.terminate();reject(new Error('Délai PDF dépassé.'));},15000);
    worker.once('message',(result:string)=>{clearTimeout(timer);void worker.terminate();resolve(result)});
    worker.once('error',error=>{clearTimeout(timer);reject(error)});
    worker.once('exit',code=>{clearTimeout(timer);if(code!==0)reject(new Error('Analyse PDF interrompue.'))});
  });
}
