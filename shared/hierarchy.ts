export const locationKinds = [
  "SITE",
  "BUILDING",
  "FLOOR",
  "ZONE",
  "ROOM",
  "PANEL",
  "EQUIPMENT",
] as const;
export const allowedParents: Record<string, readonly string[]> = {
  SITE: [],
  BUILDING: ["SITE"],
  FLOOR: ["BUILDING"],
  ZONE: ["FLOOR", "BUILDING"],
  ROOM: ["ZONE", "FLOOR"],
  PANEL: ["ROOM", "ZONE", "FLOOR", "BUILDING"],
  EQUIPMENT: ["PANEL", "ROOM", "ZONE", "FLOOR", "BUILDING"],
};
type Node = {
  id: string;
  parentId: string | null;
  clientId?: string | null;
  inheritClient?: boolean;
};
export function effectiveClient(nodes: readonly Node[], id: string) {
  const byId = new Map(nodes.map((node) => [node.id, node])),
    seen = new Set<string>();
  let current = byId.get(id);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    if (current.clientId)
      return { clientId: current.clientId, sourceId: current.id };
    if (current.inheritClient === false)
      return { clientId: null, sourceId: current.id };
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return { clientId: null, sourceId: null };
}
export function descendantIds(
  nodes: readonly Pick<Node, "id" | "parentId">[],
  id: string,
) {
  const result = new Set([id]),
    pending = [id],
    children = new Map<string, string[]>();
  for (const node of nodes)
    if (node.parentId)
      children.set(node.parentId, [
        ...(children.get(node.parentId) || []),
        node.id,
      ]);
  while (pending.length) {
    for (const child of children.get(pending.pop()!) || [])
      if (!result.has(child)) {
        result.add(child);
        pending.push(child);
      }
  }
  return result;
}
