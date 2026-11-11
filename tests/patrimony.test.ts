import test from "node:test";
import assert from "node:assert/strict";
import { searchPatrimony } from "../web/src/patrimony.js";
import type { Client, Location } from "../web/src/api.js";
const locations: Location[] = [
  {
    id: "s",
    siteId: "s",
    parentId: null,
    kind: "SITE",
    name: "Site Bruxelles",
    reference: "",
    description: "",
    clientId: "c",
  },
  {
    id: "b",
    siteId: "s",
    parentId: "s",
    kind: "BUILDING",
    name: "Bâtiment A",
    reference: "BAT-A",
    description: "",
  },
  {
    id: "e",
    siteId: "s",
    parentId: "b",
    kind: "EQUIPMENT",
    name: "Pompe électrique",
    reference: "P-42",
    description: "Circulation nord",
  },
  {
    id: "x",
    siteId: "x",
    parentId: null,
    kind: "SITE",
    name: "Autre site",
    reference: "",
    description: "",
  },
];
const clients: Client[] = [
  {
    id: "c",
    name: "Société Acmé",
    code: "ACME",
    prefix: "ACME-ELEC",
    active: true,
  },
];
test("recherche patrimoine sans accents, multicritère, parents conservés et zéro résultat", () => {
  let result = searchPatrimony(locations, clients, "electrique nord", "");
  assert.deepEqual([...result.matches], ["e"]);
  assert.deepEqual([...result.visible].sort(), ["b", "e", "s"]);
  result = searchPatrimony(locations, clients, "P-42", "EQUIPMENT");
  assert(result.matches.has("e"));
  result = searchPatrimony(locations, clients, "acme", "BUILDING");
  assert.deepEqual([...result.matches], ["b"]);
  assert.deepEqual([...result.visible].sort(), ["b", "s"]);
  assert.equal(
    searchPatrimony(locations, clients, "introuvable", "").visible.size,
    0,
  );
  assert.equal(searchPatrimony(locations, clients, "", "").matches.size, 4);
});
