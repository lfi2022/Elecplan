import { labels, type Client, type Location } from "./api";
export function normalizeSearch(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("fr")
    .trim();
}
export function searchPatrimony(
  locations: Location[],
  clients: Client[],
  query: string,
  kind: string,
) {
  const terms = normalizeSearch(query).split(/\s+/).filter(Boolean),
    matches = new Set<string>(),
    visible = new Set<string>(),
    byId = new Map(locations.map((item) => [item.id, item]));
  for (const item of locations) {
    const site = byId.get(item.siteId),
      client = clients.find((c) => c.id === site?.clientId);
    const text = normalizeSearch(
      `${item.name} ${item.reference} ${item.description} ${labels[item.kind] || ""} ${client?.name || ""} ${client?.code || ""} ${client?.prefix || ""}`,
    );
    if (
      (!kind || item.kind === kind) &&
      terms.every((term) => text.includes(term))
    )
      matches.add(item.id);
  }
  for (const id of matches) {
    let current = byId.get(id);
    while (current && !visible.has(current.id)) {
      visible.add(current.id);
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
  }
  return { matches, visible };
}
