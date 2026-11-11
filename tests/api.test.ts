import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { textPdf } from "./pdf.js";
test("parcours API : installation, RBAC, fichiers, révisions, recherche, sauvegarde et restauration", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "electroplan-api-"));
  process.env.DATA_DIR = dir;
  process.env.DATABASE_URL = `file:${path.join(dir, "electroplan.db").replaceAll("\\", "/")}`;
  process.env.SETUP_TOKEN = "test-setup-token-of-at-least-24-characters";
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
  async function request(
    method: string,
    url: string,
    payload?: any,
    expected = 200,
    auth = true,
  ) {
    const res = await app.inject({
      method: method as any,
      url: "/api" + url,
      headers: {
        ...(auth ? { cookie, "x-csrf-token": csrf } : {}),
        origin: "http://localhost:3000",
      },
      payload,
    });
    assert.equal(res.statusCode, expected, `${method} ${url}: ${res.body}`);
    return res;
  }
  async function login(email: string, password = "administrator-password") {
    const r = await request(
      "POST",
      "/auth/login",
      { email, password },
      200,
      false,
    );
    cookie =
      r.cookies.find((c) => c.name === "electroplan")!.name +
      "=" +
      r.cookies.find((c) => c.name === "electroplan")!.value;
    csrf = r.json().csrf;
  }
  try {
    assert.equal((await request("GET", "/setup")).json().required, true);
    await request(
      "POST",
      "/setup",
      {
        name: "Admin",
        email: "admin@example.test",
        password: "administrator-password",
        token: "wrong",
      },
      403,
    );
    await request(
      "POST",
      "/setup",
      {
        name: "Admin",
        email: "admin@example.test",
        password: "administrator-password",
        token: process.env.SETUP_TOKEN,
      },
      201,
    );
    await request(
      "POST",
      "/setup",
      {
        name: "Admin",
        email: "other@example.test",
        password: "administrator-password",
        token: process.env.SETUP_TOKEN,
      },
      409,
    );
    await request("GET", "/locations", undefined, 401, false);
    await login("admin@example.test");
    const badCsrf = await app.inject({
      method: "POST",
      url: "/api/locations",
      headers: { cookie },
      payload: {},
    });
    assert.equal(badCsrf.statusCode, 403);
    const badOrigin = await app.inject({
      method: "POST",
      url: "/api/locations",
      headers: { cookie, "x-csrf-token": csrf, origin: "https://evil.test" },
      payload: {},
    });
    assert.equal(badOrigin.statusCode, 403);
    const site = (
      await request(
        "POST",
        "/locations",
        { name: "Bruxelles", kind: "SITE" },
        201,
      )
    ).json();
    const otherSite = (
      await request(
        "POST",
        "/locations",
        { name: "Confidentiel", kind: "SITE" },
        201,
      )
    ).json();
    const building = (
      await request(
        "POST",
        "/locations",
        { name: "Bâtiment A", kind: "BUILDING", parentId: site.id },
        201,
      )
    ).json();
    const floor = (
      await request(
        "POST",
        "/locations",
        { name: "Rez", kind: "FLOOR", parentId: building.id },
        201,
      )
    ).json();
    const zone = (
      await request(
        "POST",
        "/locations",
        { name: "Nord", kind: "ZONE", parentId: floor.id },
        201,
      )
    ).json();
    const room = (
      await request(
        "POST",
        "/locations",
        { name: "Local technique", kind: "ROOM", parentId: zone.id },
        201,
      )
    ).json();
    const panel = (
      await request(
        "POST",
        "/locations",
        { name: "TGBT", kind: "PANEL", parentId: room.id },
        201,
      )
    ).json();
    const equipment = (
      await request(
        "POST",
        "/locations",
        { name: "Pompe", kind: "EQUIPMENT", parentId: panel.id },
        201,
      )
    ).json();
    await request(
      "POST",
      "/locations",
      { name: "Invalide", kind: "ROOM", parentId: site.id },
      400,
    );
    await request("PATCH", `/locations/${equipment.id}`, {
      name: "Pompe 1",
      reference: "P01",
      description: "Pompe de circulation",
    });
    const qr = await request("GET", `/locations/${panel.id}/qr`);
    assert.match(qr.headers["content-type"]!, /image\/png/);
    const docInput = {
      name: "Plan principal",
      reference: "ELEC-001",
      locationId: room.id,
      tags: ["urgent"],
      equipmentIds: [equipment.id],
      status: "En vigueur",
      planDate: "2026-11-11",
    };
    const doc = (await request("POST", "/documents", docInput, 201)).json();
    await request(
      "POST",
      "/documents",
      { ...docInput, planDate: "2026-99-99" },
      400,
    );
    assert.equal((await request("GET", "/documents?tag=urge")).json().total, 0);
    const secretDoc = (
      await request(
        "POST",
        "/documents",
        {
          ...docInput,
          name: "Secret",
          reference: "SECRET",
          locationId: otherSite.id,
          equipmentIds: [],
        },
        201,
      )
    ).json();
    async function upload(
      revision: string,
      name: string,
      bytes: Buffer,
      expected = 201,
    ) {
      const boundary = "----electroplan-test";
      const payload = Buffer.concat([
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
        ),
        bytes,
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ]);
      const r = await app.inject({
        method: "POST",
        url: `/api/documents/${doc.id}/versions?revision=${revision}`,
        headers: {
          cookie,
          "x-csrf-token": csrf,
          "content-type": `multipart/form-data; boundary=${boundary}`,
        },
        payload,
      });
      assert.equal(r.statusCode, expected, r.body);
      return r.json();
    }
    await upload(
      "evil",
      "evil.png",
      Buffer.from("<script>alert(1)</script>"),
      400,
    );
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/nxoAAAAASUVORK5CYII=",
      "base64",
    );
    const v1 = await upload("A", "plan.png", png);
    const v2 = await upload("B", "plan.png", png);
    await upload(
      "C",
      "schema.pdf",
      await textPdf("CIRCUITEXCLUSIF923 Installation electrique"),
    );
    assert.equal(
      (await request("GET", "/documents?q=circuitexclusif")).json().total,
      1,
    );
    await upload("D", "plan.dwg", Buffer.from("AC1032opaque CAD fixture"));
    await upload(
      "E",
      "plan.dxf",
      Buffer.from("0\nSECTION\n2\nENTITIES\n0\nENDSEC\n0\nEOF\n"),
    );
    await upload("B", "plan.png", png, 409);
    const file = await request(
      "GET",
      `/documents/${doc.id}/versions/${v1.id}/file`,
    );
    assert(file.rawPayload.equals(png));
    await request(
      "GET",
      `/documents/${doc.id}/versions/${v1.id}/file?preview=1`,
    );
    await request("POST", `/documents/${doc.id}/restore`, { versionId: v1.id });
    assert.equal(
      (await request("GET", `/documents/${doc.id}`)).json().currentVersionId,
      v1.id,
    );
    const results = (
      await request(
        "GET",
        "/documents?q=Plan&tag=urgent&status=En%20vigueur&dateFrom=2026-01-01",
      )
    ).json();
    assert.equal(results.total, 1);
    await request("PUT", `/documents/${doc.id}`, {
      ...docInput,
      name: "Plan révisé",
    });
    const user = (
      await request(
        "POST",
        "/users",
        {
          name: "Lecteur",
          email: "reader@example.test",
          password: "administrator-password",
          role: "READER",
          siteIds: [site.id],
        },
        201,
      )
    ).json();
    const adminCookie = cookie,
      adminCsrf = csrf;
    await login("reader@example.test");
    assert.equal((await request("GET", "/documents")).json().total, 1);
    assert.equal((await request("GET", "/locations")).json().length, 7);
    await request("GET", `/documents/${secretDoc.id}`, undefined, 404);
    await request("GET", `/locations/${otherSite.id}/qr`, undefined, 404);
    await request("GET", "/users", undefined, 403);
    await request("POST", "/documents", docInput, 403);
    await request("GET", "/audit", undefined, 403);
    cookie = adminCookie;
    csrf = adminCsrf;
    const backup = (await request("POST", "/admin/backups")).json();
    await request("PUT", `/documents/${doc.id}`, {
      ...docInput,
      name: "Après sauvegarde",
    });
    const admin = (await request("GET", "/admin")).json();
    assert.equal(admin.backups.length, 1);
    assert.equal(admin.storage.files, 5);
    await request("POST", "/admin/restore", {
      id: backup.id,
      confirmation: "RESTAURER",
    });
    await request("GET", "/auth/me", undefined, 401);
    await login("admin@example.test");
    assert.equal(
      (await request("GET", `/documents/${doc.id}`)).json().name,
      "Plan révisé",
    );
    assert((await request("GET", "/audit")).json().total > 10);
    await request("PUT", `/users/${user.id}`, {
      name: "Lecteur",
      email: "reader@example.test",
      role: "READER",
      permissions: ["audit:read"],
      siteIds: [site.id],
      active: false,
    });
    await request("DELETE", `/locations/${site.id}`, undefined, 409);
    await request("DELETE", `/documents/${doc.id}`);
    await request("GET", `/documents/${doc.id}`, undefined, 404);
    await request("POST", "/auth/logout");
    await request("GET", "/auth/me", undefined, 401);
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
