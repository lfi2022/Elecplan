import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";

test("clients : références transactionnelles, héritage des sites, anciens documents et droits", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "ep-clients-"));
  Object.assign(process.env, {
    DATA_DIR: dir,
    DATABASE_URL: `file:${path.join(dir, "electroplan.db").replaceAll("\\", "/")}`,
    PUBLIC_URL: "http://localhost:3000",
    SETUP_TOKEN: "clients-test-setup-token-long-enough",
  });
  const migration = spawnSync(
    process.execPath,
    ["node_modules/tsx/dist/cli.mjs", "scripts/migrate.ts"],
    { env: process.env, encoding: "utf8" },
  );
  assert.equal(migration.status, 0, migration.stdout + migration.stderr);
  const { buildApp } = await import("../server/app.js");
  const app = await buildApp({ logger: false });
  let cookie = "",
    csrf = "";
  async function req(
    method: string,
    url: string,
    payload?: unknown,
    status = 200,
  ) {
    const result = await app.inject({
      method: method as any,
      url: "/api" + url,
      headers: {
        cookie,
        "x-csrf-token": csrf,
        origin: "http://localhost:3000",
      },
      payload,
    });
    assert.equal(result.statusCode, status, `${method} ${url} ${result.body}`);
    return result.json();
  }
  async function login(email: string) {
    const result = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email, password: "administrator-password" },
    });
    assert.equal(result.statusCode, 200);
    cookie = `electroplan=${result.cookies[0].value}`;
    csrf = result.json().csrf;
  }
  try {
    await req(
      "POST",
      "/setup",
      {
        name: "Admin",
        email: "admin@client.test",
        password: "administrator-password",
        token: process.env.SETUP_TOKEN,
      },
      201,
    );
    await login("admin@client.test");
    const client = await req(
      "POST",
      "/clients",
      {
        name: "Client Acme",
        code: "acme",
        prefix: "acme-elec",
        email: "contact@acme.test",
      },
      201,
    );
    assert.equal(client.prefix, "CLIENT-ACME-ELEC");
    const duplicate = await req(
      "POST",
      "/clients",
      { name: "Client Acme" },
      201,
    );
    assert.notEqual(duplicate.code, client.code);
    assert.equal(duplicate.prefix, "CLIENT-ACME-2-ELEC");
    const renamed = await req("PUT", `/clients/${client.id}`, {
      name: "Acme renommé",
    });
    assert.equal(renamed.code, client.code);
    assert.equal(renamed.prefix, client.prefix);
    await req(
      "POST",
      "/clients",
      { name: "Invalide", code: "bad", prefix: "../escape" },
      400,
    );
    const privateClient = await req(
      "POST",
      "/clients",
      { name: "Client privé", code: "PRIVE", prefix: "PRIVE" },
      201,
    );
    const site = await req(
        "POST",
        "/locations",
        { kind: "SITE", name: "Site Acme" },
        201,
      ),
      legacy = await req(
        "POST",
        "/documents",
        {
          name: "Référence historique",
          reference: "CLIENT-ACME-ELEC-00001",
          locationId: site.id,
        },
        201,
      );
    await req("PATCH", `/locations/${site.id}`, {
      name: site.name,
      reference: "",
      description: "",
      clientId: client.id,
    });
    const building = await req(
      "POST",
      "/locations",
      { kind: "BUILDING", name: "Bâtiment Acme", parentId: site.id },
      201,
    );
    await req(
      "POST",
      "/locations",
      {
        kind: "BUILDING",
        name: "Mauvais rattachement",
        parentId: site.id,
        clientId: "00000000-0000-4000-8000-000000000001",
      },
      400,
    );
    const first = await req(
      "POST",
      "/documents",
      {
        name: "Premier plan",
        reference: "reference-libre-ignoree",
        locationId: building.id,
      },
      201,
    );
    assert.equal(first.reference, "CLIENT-ACME-ELEC-00002");
    assert.equal(first.clientId, client.id);
    const batch = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        req(
          "POST",
          "/documents",
          { name: `Plan ${i}`, locationId: building.id },
          201,
        ),
      ),
    );
    assert.equal(new Set(batch.map((d) => d.reference)).size, 6);
    assert.deepEqual(
      batch.map((d) => d.clientNumber).sort((a, b) => a - b),
      [3, 4, 5, 6, 7, 8],
    );
    assert.equal(
      (await req("GET", `/documents/${legacy.id}`)).reference,
      "CLIENT-ACME-ELEC-00001",
    );
    assert.equal(
      (await req("GET", `/documents?clientId=${client.id}`)).total,
      7,
    );
    await req(
      "PUT",
      `/documents/${first.id}`,
      { name: "Modifié", reference: "AUTRE", locationId: building.id },
      400,
    );
    await req("PUT", `/documents/${first.id}`, {
      name: "Modifié",
      reference: first.reference,
      locationId: building.id,
    });
    await req(
      "PUT",
      `/clients/${client.id}`,
      { name: client.name, code: client.code, prefix: "NOUVEAU" },
      200,
    );
    assert.equal(
      (await req("GET", `/documents/${first.id}`)).reference,
      first.reference,
    );
    await req("PUT", `/clients/${client.id}`, {
      name: client.name,
      code: client.code,
      prefix: client.prefix,
    });
    await req(
      "PATCH",
      `/locations/${site.id}`,
      {
        name: site.name,
        reference: "",
        description: "",
        clientId: privateClient.id,
      },
      200,
    );
    assert.equal(
      (await req("GET", `/documents/${first.id}`)).clientId,
      client.id,
    );
    await req("PATCH", `/locations/${site.id}`, {
      name: site.name,
      reference: "",
      description: "",
      clientId: client.id,
    });
    await req("DELETE", `/documents/${first.id}`);
    const afterDelete = await req(
      "POST",
      "/documents",
      { name: "Après suppression", locationId: building.id },
      201,
    );
    assert.equal(afterDelete.reference, "CLIENT-ACME-ELEC-00009");
    await req("PUT", `/clients/${client.id}`, {
      name: client.name,
      code: client.code,
      prefix: client.prefix,
      active: false,
    });
    await req(
      "POST",
      "/documents",
      { name: "Bloqué", locationId: building.id },
      409,
    );
    await req("PUT", `/clients/${client.id}`, {
      name: client.name,
      code: client.code,
      prefix: client.prefix,
      active: true,
    });
    await req(
      "POST",
      "/users",
      {
        name: "Lecteur Acme",
        email: "reader@client.test",
        password: "administrator-password",
        role: "READER",
        siteIds: [site.id],
      },
      201,
    );
    await login("reader@client.test");
    const visible = await req("GET", "/clients");
    assert.equal(visible.length, 1);
    assert.equal(visible[0].id, client.id);
    assert.equal(visible[0].email, undefined);
    assert.equal(visible[0].nextNumber, undefined);
    await req(
      "POST",
      "/clients",
      { name: "Interdit", code: "TEST", prefix: "TEST" },
      403,
    );
    assert.equal(
      (await req("GET", `/documents?clientId=${privateClient.id}`)).total,
      0,
    );
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
