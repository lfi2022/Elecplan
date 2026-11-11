import { effectiveClient } from "./hierarchy.js";
export const electricalPlanStages = ["PROVISIONAL", "FINAL"] as const;
export type ElectricalPlanStage = (typeof electricalPlanStages)[number];
export const electricalPlanStageLabels: Record<ElectricalPlanStage, string> = {
  PROVISIONAL: "Provisoire",
  FINAL: "Définitif",
};
type Folder = {
  id: string;
  name: string;
  parentId: string | null;
  clientId?: string | null;
  inheritClient?: boolean;
  electricalPlanStage?: ElectricalPlanStage | null;
};
type Customer = {
  id: string;
  name: string;
  electricalPlanStage?: ElectricalPlanStage | null;
};
export function electricalPlanStageForFolder(
  locations: readonly Folder[],
  clients: readonly Customer[],
  id: string,
) {
  const byId = new Map(locations.map((location) => [location.id, location])),
    seen = new Set<string>();
  let current = byId.get(id);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    if (current.electricalPlanStage)
      return {
        stage: current.electricalPlanStage,
        source: "location" as const,
        sourceId: current.id,
        sourceName: current.name,
      };
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  const clientId = effectiveClient(locations, id).clientId,
    client = clients.find((client) => client.id === clientId);
  if (client?.electricalPlanStage)
    return {
      stage: client.electricalPlanStage,
      source: "client" as const,
      sourceId: client.id,
      sourceName: client.name,
    };
  return { stage: null, source: null, sourceId: null, sourceName: null };
}
