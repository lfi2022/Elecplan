import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

test("édition complète : héritage client, réaffectation, historique, déplacements et protections", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "ep-edit-"));
  Object.assign(process.env, {
    DATA_DIR: dir,
    DATABASE_URL: `file:${path.join(dir, "electroplan.db").replaceAll("\\", "/")}`,
    PUBLIC_URL: "http://localhost:3000",
    SETUP_TOKEN: "editing-setup-token-of-at-least-24-characters",
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
      headers: { cookie, "x-csrf-token": csrf },
      payload,
    });
    assert.equal(result.statusCode, status, `${method} ${url}: ${result.body}`);
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
        email: "admin@edit.test",
        password: "administrator-password",
        token: process.env.SETUP_TOKEN,
      },
      201,
    );
    await login("admin@edit.test");
    const a = await req(
        "POST",
        "/clients",
        { name: "Client A", code: "CLA", prefix: "CLIENT-A" },
        201,
      ),
      b = await req(
        "POST",
        "/clients",
        { name: "Client B", code: "CLB", prefix: "CLIENT-B" },
        201,
      );
    const site = await req(
        "POST",
        "/locations",
        { kind: "SITE", name: "Site origine", clientId: a.id },
        201,
      ),
      other = await req(
        "POST",
        "/locations",
        { kind: "SITE", name: "Site cible", clientId: a.id },
        201,
      );
    const building = await req(
        "POST",
        "/locations",
        { kind: "BUILDING", name: "Bâtiment", parentId: site.id },
        201,
      ),
      floor = await req(
        "POST",
        "/locations",
        { kind: "FLOOR", name: "Étage", parentId: building.id },
        201,
      ),
      panel = await req(
        "POST",
        "/locations",
        { kind: "PANEL", name: "Tableau", parentId: floor.id },
        201,
      );
    const old = await req(
      "POST",
      "/documents",
      {
        name: "Plan avant changement",
        locationId: panel.id,
        equipmentIds: [panel.id],
      },
      201,
    );
    assert.equal(old.reference, "CLIENT-A-00001");
    const fields = {
      name: "Bâtiment modifié",
      reference: "BAT-42",
      description: "Description modifiée",
    };
    await req("PATCH", `/locations/${building.id}`, {
      ...fields,
      clientId: b.id,
    });
    assert.equal((await req("GET", `/documents/${old.id}`)).clientId, a.id);
    const fresh = await req(
      "POST",
      "/documents",
      { name: "Plan après changement", locationId: panel.id },
      201,
    );
    assert.equal(fresh.reference, "CLIENT-B-00001");
    await req("PUT", `/documents/${old.id}`, {
      name: "Plan réaffecté",
      locationId: panel.id,
      useLocationClient: true,
      equipmentIds: [panel.id],
    });
    let updated = await req("GET", `/documents/${old.id}`);
    assert.equal(updated.reference, "CLIENT-B-00002");
    assert.equal(updated.referenceHistory[0].reference, old.reference);
    assert.equal(updated.referenceHistory[0].clientId, a.id);
    assert.equal((await req("GET", "/documents?q=CLIENT-A-00001")).total, 1);
    await req("PUT", `/clients/${b.id}`, {
      name: b.name,
      code: b.code,
      prefix: "NOUVEAU-B",
    });
    await req("PUT", `/documents/${old.id}`, {
      name: "Référence renouvelée",
      locationId: panel.id,
      regenerateReference: true,
      equipmentIds: [panel.id],
    });
    updated = await req("GET", `/documents/${old.id}`);
    assert.equal(updated.reference, "NOUVEAU-B-00003");
    assert.equal(updated.referenceHistory.length, 2);
    await req("PATCH", `/locations/${building.id}`, {
      ...fields,
      clientId: null,
      inheritClient: false,
    });
    await req(
      "POST",
      "/documents",
      { name: "Référence libre exigée", locationId: panel.id },
      400,
    );
    await req(
      "POST",
      "/documents",
      { name: "Référence libre", reference: "MANUEL-42", locationId: panel.id },
      201,
    );
    await req("PATCH", `/locations/${building.id}`, {
      ...fields,
      clientId: null,
      inheritClient: true,
    });
    const inherited = await req(
      "POST",
      "/documents",
      { name: "Retour héritage", locationId: panel.id },
      201,
    );
    assert.equal(inherited.clientId, a.id);
    await req(
      "PATCH",
      `/locations/${building.id}`,
      { ...fields, parentId: floor.id },
      400,
    );
    await req(
      "PATCH",
      `/locations/${panel.id}`,
      { name: "Tableau", reference: "", description: "", kind: "ROOM" },
      409,
    );
    const outside = await req(
      "POST",
      "/documents",
      { name: "Lien externe", locationId: site.id, equipmentIds: [panel.id] },
      201,
    );
    await req(
      "PATCH",
      `/locations/${building.id}`,
      { ...fields, parentId: other.id },
      409,
    );
    assert.equal(
      (await req("GET", "/locations")).find((n: any) => n.id === building.id)
        .parentId,
      site.id,
    );
    await req("PUT", `/documents/${outside.id}`, {
      name: outside.name,
      locationId: site.id,
      reference: outside.reference,
      equipmentIds: [],
    });
    await req("PATCH", `/locations/${building.id}`, {
      ...fields,
      parentId: other.id,
    });
    assert.equal((await req("GET", `/documents/${old.id}`)).siteId, other.id);
    assert.equal(
      (await req("GET", "/locations")).find((n: any) => n.id === panel.id)
        .siteId,
      other.id,
    );
    const empty = await req(
      "POST",
      "/locations",
      { name: "Étage vide", kind: "FLOOR", parentId: building.id },
      201,
    );
    await req("PATCH", `/locations/${empty.id}`, {
      name: "Zone reconvertie",
      reference: "Z-42",
      description: "",
      kind: "ZONE",
    });
    await req("DELETE", `/documents/${fresh.id}`);
    await req("PUT", `/clients/${b.id}`, {
      name: b.name,
      code: b.code,
      prefix: "CLIENT-B",
    });
    await req("PATCH", `/locations/${building.id}`, {
      ...fields,
      clientId: b.id,
    });
    const reserved = await req(
      "POST",
      "/documents",
      { name: "Numéro après édition", locationId: panel.id },
      201,
    );
    assert.equal(reserved.reference, "CLIENT-B-00004");
    await req(
      "POST",
      "/users",
      {
        name: "Éditeur",
        email: "editor@edit.test",
        password: "administrator-password",
        role: "EDITOR",
        siteIds: [other.id],
      },
      201,
    );
    await login("editor@edit.test");
    await req(
      "PATCH",
      `/locations/${building.id}`,
      { ...fields, clientId: a.id },
      403,
    );
    await req(
      "PATCH",
      `/locations/${building.id}`,
      { ...fields, parentId: site.id },
      404,
    );
    await req("GET", `/documents/${outside.id}`, undefined, 404);
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
