import type { Location } from "./api";
import { labels } from "./api";
export function locationLabel(location: Location, locations: Location[]) {
  const byId = new Map(locations.map((item) => [item.id, item])),
    seen = new Set<string>(),
    path: string[] = [];
  let current: Location | undefined = location;
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    path.unshift(current.name);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return path.join(" / ");
}
const normalize = (value: string) =>
  value.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("fr").trim();
export function buildLocationIndex(locations: Location[]) {
  const byId = new Map(locations.map((item) => [item.id, item])),
    collator = new Intl.Collator("fr", { numeric: true, sensitivity: "base" });
  return locations
    .map((location) => {
      let current: Location | undefined = location;
      const names: string[] = [],
        seen = new Set<string>();
      while (current && !seen.has(current.id)) {
        seen.add(current.id);
        names.unshift(current.name);
        current = current.parentId ? byId.get(current.parentId) : undefined;
      }
      const label = names.join(" / ");
      return {
        location,
        label,
        content: normalize(
          `${label} ${location.reference} ${labels[location.kind]}`,
        ),
      };
    })
    .sort((a, b) => collator.compare(a.label, b.label));
}
export function searchLocationIndex(
  index: ReturnType<typeof buildLocationIndex>,
  query: string,
  limit = 20,
) {
  const normalized = normalize(query);
  if (normalized.length < 3) return { items: [], total: 0 };
  const terms = normalized.split(/\s+/),
    matches = index.filter((item) =>
      terms.every((term) => item.content.includes(term)),
    );
  return {
    items: matches.slice(0, limit).map((item) => item.location),
    total: matches.length,
  };
}
export function searchLocations(
  locations: Location[],
  query: string,
  limit = 20,
) {
  return searchLocationIndex(buildLocationIndex(locations), query, limit);
}
