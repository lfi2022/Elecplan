import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
const require = createRequire("/opt/electroplan/package.json");
const { PDFDocument, StandardFonts } = require("pdf-lib");
let cookie = "",
  csrf = "";
for (let i = 0; i < 50; i++) {
  try {
    await fetch("http://127.0.0.1:3000/api/health");
    break;
  } catch {
    await new Promise((r) => setTimeout(r, 100));
  }
}
async function api(url, body) {
  const response = await fetch("http://127.0.0.1:3000/api" + url, {
    method: body ? "POST" : "GET",
    headers: {
      cookie,
      "x-csrf-token": csrf,
      ...(body instanceof FormData
        ? {}
        : { "content-type": "application/json" }),
    },
    body: body
      ? body instanceof FormData
        ? body
        : JSON.stringify(body)
      : undefined,
  });
  const json = await response.json();
  assert(response.ok, JSON.stringify(json));
  if (url === "/auth/login") {
    cookie = response.headers.get("set-cookie").split(";")[0];
    csrf = json.csrf;
  }
  return json;
}
const token = (
  await readFile("/etc/electroplan/electroplan.env", "utf8")
).match(/^SETUP_TOKEN=(.+)$/m)[1];
await api("/setup", {
  name: "Package QA",
  email: "package@example.test",
  password: "package-test-password",
  token,
});
await api("/auth/login", {
  email: "package@example.test",
  password: "package-test-password",
});
const site = await api("/locations", {
  name: "Site paquet hors ligne",
  kind: "SITE",
});
const doc = await api("/documents", {
  name: "PDF paquet",
  reference: "PACK-001",
  locationId: site.id,
});
const pdf = await PDFDocument.create();
const font = await pdf.embedFont(StandardFonts.Helvetica);
pdf.addPage().drawText("PAQUETNATIFEXCLUSIF", { font });
const form = new FormData();
form.append(
  "file",
  new Blob([await pdf.save({ useObjectStreams: false })], {
    type: "application/pdf",
  }),
  "schema.pdf",
);
await api(`/documents/${doc.id}/versions?revision=A`, form);
assert.equal((await api("/documents?q=paquetnatif")).total, 1);
const backup = await api("/admin/backups", {});
await api("/admin/restore", { id: backup.id, confirmation: "RESTAURER" });
await api("/auth/login", {
  email: "package@example.test",
  password: "package-test-password",
});
assert.equal((await api("/documents?q=paquetnatif")).total, 1);
console.log(
  "PASS: installed package offline setup, login, hierarchy, PDF extraction/search, backup and restore.",
);
