import test from "node:test";
import assert from "node:assert/strict";
import { electricalPlanStageForFolder } from "../shared/electricalPlans.js";
import type { Location, Client } from "../web/src/api.js";

test("plans électriques : état propre, héritage du bâtiment/client et absence d’indication", () => {
  const clients: Client[] = [
    {
      id: "a",
      name: "Client A",
      code: "A",
      prefix: "A",
      active: true,
      electricalPlanStage: "PROVISIONAL",
    },
    {
      id: "b",
      name: "Client B",
      code: "B",
      prefix: "B",
      active: true,
      electricalPlanStage: "FINAL",
    },
  ];
  const nodes: Location[] = [
    {
      id: "s",
      kind: "SITE",
      siteId: "s",
      parentId: null,
      name: "Site",
      reference: "",
      description: "",
      clientId: "a",
    },
    {
      id: "b",
      kind: "BUILDING",
      siteId: "s",
      parentId: "s",
      name: "Bâtiment",
      reference: "",
      description: "",
    },
    {
      id: "r",
      kind: "ROOM",
      siteId: "s",
      parentId: "b",
      name: "Local",
      reference: "",
      description: "",
    },
  ];
  let result = electricalPlanStageForFolder(nodes, clients, "r");
  assert.equal(result.stage, "PROVISIONAL");
  assert.equal(result.source, "client");
  assert.equal(result.sourceName, "Client A");
  nodes[1].electricalPlanStage = "FINAL";
  result = electricalPlanStageForFolder(nodes, clients, "r");
  assert.equal(result.stage, "FINAL");
  assert.equal(result.sourceId, "b");
  nodes[1].electricalPlanStage = "PROVISIONAL";
  assert.equal(
    electricalPlanStageForFolder(nodes, clients, "r").stage,
    "PROVISIONAL",
  );
  nodes[1].electricalPlanStage = null;
  nodes[1].clientId = "b";
  assert.equal(
    electricalPlanStageForFolder(nodes, clients, "r").stage,
    "FINAL",
  );
  nodes[0].electricalPlanStage = "PROVISIONAL";
  assert.equal(electricalPlanStageForFolder(nodes, clients, "r").sourceId, "s");
  nodes[0].electricalPlanStage = null;
  nodes[1].clientId = null;
  nodes[1].inheritClient = false;
  assert.equal(electricalPlanStageForFolder(nodes, clients, "r").stage, null);
  assert.equal(
    electricalPlanStageForFolder(nodes, clients, "unknown").stage,
    null,
  );
});
