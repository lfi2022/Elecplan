import { verify, createPublicKey } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
const payloadSchema = z.object({ customer: z.string().min(1).max(200), edition: z.enum(['Standard', 'Professionnel']), expiresAt: z.string().datetime().nullable(), installationId: z.string().uuid() }).strict();
export async function verifyLicense(input: unknown, installationId: string) {
  const envelope = z.object({ payload: z.string().max(10000), signature: z.string().max(1000) }).strict().parse(input);
  if (!process.env.LICENSE_PUBLIC_KEY_FILE) throw new Error('Clé publique éditeur non configurée.');
  const key = createPublicKey(await readFile(process.env.LICENSE_PUBLIC_KEY_FILE));
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('Clé Ed25519 requise.');
  const bytes = Buffer.from(envelope.payload, 'base64');
  if (!verify(null, bytes, key, Buffer.from(envelope.signature, 'base64'))) throw new Error('Signature de licence invalide.');
  const payload = payloadSchema.parse(JSON.parse(bytes.toString('utf8')));
  if (payload.installationId !== installationId) throw new Error('Licence destinée à une autre installation.');
  if (payload.expiresAt && Date.parse(payload.expiresAt) <= Date.now()) throw new Error('Licence expirée.');
  return payload;
}
