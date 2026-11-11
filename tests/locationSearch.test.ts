import test from "node:test";
import assert from "node:assert/strict";
import { searchLocations } from "../web/src/locationSearch.js";
import type { Location } from "../web/src/api.js";
test("localisations : seuil trois caractères, chemins, références, accents et résultats bornés", () => {
  const site: Location = {
    id: "s",
    kind: "SITE",
    siteId: "s",
    parentId: null,
    name: "Hôpital de Namur",
    reference: "NAM",
    description: "",
  };
  const nodes: Location[] = [
    site,
    ...Array.from({ length: 30 }, (_, i) => ({
      id: `r${i}`,
      kind: "ROOM",
      siteId: "s",
      parentId: "s",
      name: `Local électrique ${i + 1}`,
      reference: `LOC-${i + 1}`,
      description: "",
    })),
  ];
  assert.equal(searchLocations(nodes, "lo").total, 0);
  const matches = searchLocations(nodes, "electrique");
  assert.equal(matches.total, 30);
  assert.equal(matches.items.length, 20);
  assert.equal(searchLocations(nodes, "Namur LOC-29").items[0].id, "r28");
  assert.equal(searchLocations(nodes, "hopital").total, 31);
  assert.equal(searchLocations(nodes, "introuvable").total, 0);
});
