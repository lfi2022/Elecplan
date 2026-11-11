import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { writeFile, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  hashPassword,
  verifyPassword,
  sameSecret,
  can,
} from "../server/security.js";
import { verifyLicense } from "../server/license.js";
test("hachage salé, comparaison et permissions", async () => {
  const hash = await hashPassword("long-password-123");
  assert.notEqual(hash, await hashPassword("long-password-123"));
  assert(await verifyPassword("long-password-123", hash));
  assert(!(await verifyPassword("wrong", hash)));
  assert(sameSecret("a", "a"));
  assert(!sameSecret("a", "b"));
  const user: any = { role: "READER", permissions: "[]" };
  assert(can(user, "documents:read"));
  assert(!can(user, "documents:write"));
  user.permissions = '["audit:read"]';
  assert(can(user, "audit:read"));
});
test("licence Ed25519 : signature, installation et expiration", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "ep-license-"));
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const keyFile = path.join(dir, "public.pem");
  await writeFile(keyFile, publicKey.export({ type: "spki", format: "pem" }));
  process.env.LICENSE_PUBLIC_KEY_FILE = keyFile;
  const installationId = "aa111111-1111-4111-8111-111111111111";
  const envelope = (fields = {}) => {
    const payload = Buffer.from(
      JSON.stringify({
        customer: "Client",
        edition: "Professionnel",
        expiresAt: null,
        installationId,
        ...fields,
      }),
    );
    return {
      payload: payload.toString("base64"),
      signature: sign(null, payload, privateKey).toString("base64"),
    };
  };
  try {
    assert.equal(
      (await verifyLicense(envelope(), installationId)).edition,
      "Professionnel",
    );
    await assert.rejects(
      verifyLicense(
        { ...envelope(), signature: Buffer.alloc(64).toString("base64") },
        installationId,
      ),
      /Signature/,
    );
    await assert.rejects(
      verifyLicense(envelope(), "bb111111-1111-4111-8111-111111111111"),
      /autre/,
    );
    await assert.rejects(
      verifyLicense(
        envelope({ expiresAt: "2020-01-01T00:00:00.000Z" }),
        installationId,
      ),
      /expirée/,
    );
  } finally {
    delete process.env.LICENSE_PUBLIC_KEY_FILE;
    await rm(dir, { recursive: true, force: true });
  }
});
