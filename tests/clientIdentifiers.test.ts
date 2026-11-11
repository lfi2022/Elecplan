import test from "node:test";
import assert from "node:assert/strict";
import { clientIdentifiers } from "../server/clients.js";
test("codes clients automatiques : accents, format, longueur et suffixes distincts", () => {
  assert.deepEqual(clientIdentifiers("Société Électricité"), {
    code: "SOCIETE-ELECTRICITE",
    prefix: "SOCIETE-ELECTRICITE-ELEC",
  });
  assert.deepEqual(clientIdentifiers("Client Atelier"), {
    code: "CLIENT-ATELIER",
    prefix: "CLIENT-ATELIER-ELEC",
  });
  assert.notEqual(
    clientIdentifiers("Client Atelier", 2).code,
    clientIdentifiers("Client Atelier").code,
  );
  for (const name of [
    "A",
    "中文",
    "⚡",
    "Un très long nom de client avec de nombreux mots",
  ]) {
    const ids = clientIdentifiers(name, 24);
    assert.match(ids.code, /^[A-Z0-9]+(?:-[A-Z0-9]+)*$/);
    assert(ids.code.length <= 20);
    assert(ids.prefix.endsWith("-ELEC"));
  }
});
