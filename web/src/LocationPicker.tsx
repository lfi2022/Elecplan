import { useEffect, useId, useRef, useState, useMemo } from "react";
import type { Location } from "./api";
import { labels } from "./api";
import { buildLocationIndex, searchLocationIndex } from "./locationSearch";
import "./locationPicker.css";

export function LocationPicker({
  locations,
  value,
  onChange,
}: {
  locations: Location[];
  value: string;
  onChange: (id: string) => void;
}) {
  const id = useId(),
    input = useRef<HTMLInputElement>(null),
    changeButton = useRef<HTMLButtonElement>(null),
    focusSelection = useRef(false);
  const [query, setQuery] = useState(""),
    [open, setOpen] = useState(false),
    [active, setActive] = useState(-1),
    [focusNext, setFocusNext] = useState(false);
  const index = useMemo(() => buildLocationIndex(locations), [locations]);
  const paths = useMemo(
    () => new Map(index.map((item) => [item.location.id, item.label])),
    [index],
  );
  const selected = locations.find((location) => location.id === value),
    results = searchLocationIndex(index, query),
    expanded = !selected && open && query.trim().length >= 3;
  useEffect(() => {
    input.current?.setCustomValidity(
      selected
        ? ""
        : "Sélectionnez une localisation dans les résultats de recherche.",
    );
    if (focusNext && !selected) {
      input.current?.focus();
      setFocusNext(false);
    }
    if (selected && focusSelection.current) {
      changeButton.current?.focus();
      focusSelection.current = false;
    }
  }, [selected, query, focusNext]);
  useEffect(() => {
    if (expanded && active >= 0)
      document
        .getElementById(`${id}-option-${active}`)
        ?.scrollIntoView({ block: "nearest" });
  }, [active, expanded, id]);
  function choose(location: Location) {
    focusSelection.current = true;
    onChange(location.id);
    setOpen(false);
    setQuery("");
    setActive(-1);
  }
  return (
    <div className="field location-picker">
      <label htmlFor={id}>Localisation</label>
      <input
        type="hidden"
        name="locationId"
        value={selected ? selected.id : ""}
      />
      {selected ? (
        <div className="location-picker-selection">
          <div>
            <strong>{selected.name}</strong>
            <small>
              {labels[selected.kind]} · {paths.get(selected.id)}
              {selected.reference ? ` · ${selected.reference}` : ""}
            </small>
          </div>
          <button
            type="button"
            ref={changeButton}
            className="secondary"
            onClick={() => {
              onChange("");
              setQuery("");
              setActive(-1);
              setOpen(true);
              setFocusNext(true);
            }}
          >
            Changer la localisation
          </button>
        </div>
      ) : (
        <>
          <input
            id={id}
            ref={input}
            role="combobox"
            aria-label="Rechercher une localisation"
            aria-autocomplete="list"
            aria-expanded={expanded}
            aria-controls={`${id}-results`}
            aria-activedescendant={
              expanded && active >= 0 ? `${id}-option-${active}` : undefined
            }
            aria-describedby={`${id}-help`}
            autoComplete="off"
            placeholder="Rechercher un site, bâtiment, local… (3 caractères)"
            value={query}
            required
            onFocus={() => setOpen(true)}
            onBlur={() => setOpen(false)}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(-1);
              setOpen(true);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                setOpen(true);
                if (results.items.length)
                  setActive((previous) =>
                    e.key === "ArrowDown"
                      ? (previous + 1) % results.items.length
                      : (previous <= 0 ? results.items.length : previous) - 1,
                  );
              } else if (e.key === "Enter") {
                e.preventDefault();
                if (expanded && active >= 0 && results.items[active])
                  choose(results.items[active]);
              } else if (e.key === "Escape" && open) {
                e.preventDefault();
                e.stopPropagation();
                setOpen(false);
              }
            }}
          />
          <small id={`${id}-help`}>
            Saisissez au moins 3 caractères. Recherche par nom, référence ou
            chemin, sans tenir compte des accents.
          </small>
          {expanded && (
            <div className="location-picker-popup">
              <ul
                id={`${id}-results`}
                role="listbox"
                aria-label="Localisations trouvées"
              >
                {results.items.map((location, index) => (
                  <li
                    key={location.id}
                    id={`${id}-option-${index}`}
                    role="option"
                    aria-selected={active === index}
                    data-location-id={location.id}
                    className={active === index ? "active" : ""}
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseEnter={() => setActive(index)}
                    onClick={() => choose(location)}
                  >
                    <strong>{location.name}</strong>
                    <small>
                      {labels[location.kind]} · {paths.get(location.id)}
                      {location.reference ? ` · ${location.reference}` : ""}
                    </small>
                  </li>
                ))}
              </ul>
              <p role="status">
                {results.total === 0
                  ? "Aucune localisation trouvée."
                  : results.total > results.items.length
                    ? `${results.items.length} résultats sur ${results.total}. Affinez votre recherche.`
                    : `${results.total} résultat${results.total > 1 ? "s" : ""}.`}
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
