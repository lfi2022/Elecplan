import React, {
  useEffect,
  useState,
  useId,
  type FormEvent,
  type ReactNode,
} from "react";
import { createRoot } from "react-dom/client";
import {
  api,
  setCsrf,
  formatDate,
  bytes,
  labels,
  type Location,
  type Client,
} from "./api";
import { Clients } from "./Clients";
import { searchPatrimony } from "./patrimony";
import {
  effectiveClient,
  descendantIds,
  allowedParents,
  locationKinds,
} from "../../shared/hierarchy";
import "./style.css";
const DocumentReader = React.lazy(() =>
  import("./DocumentReader").then((module) => ({
    default: module.DocumentReader,
  })),
);
type Account = {
  id: string;
  name: string;
  email: string;
  role: string;
  active: boolean;
  permissions: string[];
  siteIds: string[];
};
type Context = {
  user: Account;
  capabilities: string[];
  license: { edition: string };
  organization: string;
};
const permissionLabels: Record<string, string> = {
  "locations:write": "Gérer les localisations",
  "documents:write": "Créer et modifier les documents",
  "documents:read": "Consulter les documents",
  "documents:download": "Télécharger les fichiers",
  "documents:delete": "Supprimer les documents",
  "audit:read": "Consulter le journal",
};
function Field({ label, children }: { label: string; children: ReactNode }) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {React.Children.map(children, (child) =>
        React.isValidElement(child) &&
        typeof child.type === "string" &&
        ["input", "select", "textarea"].includes(child.type)
          ? React.cloneElement(child as React.ReactElement<any>, { id })
          : child,
      )}
    </div>
  );
}
function Button({
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...props}>{children}</button>;
}
function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="empty">
      <span className="empty-icon">▤</span>
      <p>{children}</p>
    </div>
  );
}
function Modal({
  title,
  children,
  close,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
}) {
  const dialogRef = React.useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current!;
    dialog.querySelector<HTMLElement>("input,select,textarea,button")?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      }
      if (event.key === "Tab") {
        const elements = Array.from(
          dialog.querySelectorAll<HTMLElement>(
            "button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),a[href],iframe",
          ),
        ).filter((el) => el.getClientRects().length);
        const first = elements[0],
          last = elements.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", keydown);
    return () => {
      document.removeEventListener("keydown", keydown);
      previous?.focus();
    };
  }, []);
  return (
    <div className="veil" onClick={close}>
      <section
        className="modal"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="section-head">
          <h2>{title}</h2>
          <button className="icon" aria-label="Fermer" onClick={close}>
            ×
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}
function App() {
  const [context, setContext] = useState<Context | null>(null),
    [setup, setSetup] = useState(false),
    [loading, setLoading] = useState(true),
    [page, setPage] = useState("dashboard"),
    [locations, setLocations] = useState<Location[]>([]),
    [clients, setClients] = useState<Client[]>([]),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [theme, setTheme] = useState(localStorage.getItem("theme") || "light"),
    [refresh, setRefresh] = useState(0),
    [selectedDoc, setSelectedDoc] = useState<string | null>(null);
  const initialLocation =
    new URLSearchParams(location.search).get("location") || "";
  const [locationId, setLocationId] = useState(initialLocation);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("theme", theme);
  }, [theme]);
  async function load() {
    try {
      const s = await api("/setup");
      setSetup(s.required);
      if (!s.required) {
        try {
          const c = await api("/auth/me");
          setCsrf(c.csrf);
          setContext(c);
          setLocations(await api("/locations"));
          setClients(await api("/clients"));
          if (initialLocation) setPage("locations");
        } catch {
          setContext(null);
        }
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  useEffect(() => {
    if (context)
      api<Client[]>("/clients")
        .then(setClients)
        .catch((e) => setError(e.message));
    if (context)
      api<Location[]>("/locations")
        .then(setLocations)
        .catch((e) => setError(e.message));
    if (context)
      api("/auth/me")
        .then((c) => {
          setCsrf(c.csrf);
          setContext(c);
        })
        .catch(() => setContext(null));
  }, [refresh]);
  const notify = (message: string) => {
    setNotice(message);
    setError("");
    setRefresh((v) => v + 1);
  };
  const handleError = (e: unknown) => setError((e as Error).message);
  const can = (p: string) => !!context?.capabilities.includes(p);
  if (loading)
    return (
      <div className="auth">
        <p>Chargement d’ElectroPlan…</p>
      </div>
    );
  if (!context)
    return (
      <div className="auth">
        <section className="auth-card">
          <Logo />
          <p className="eyebrow">PATRIMOINE TECHNIQUE · SELF-HOSTED</p>
          <h1>
            {setup
              ? "Bienvenue dans ElectroPlan"
              : "Votre documentation, au bon endroit."}
          </h1>
          <p className="muted">
            {setup
              ? "Configurez votre installation et créez le premier compte administrateur."
              : "Connectez-vous pour retrouver vos plans et équipements."}
          </p>
          {error && (
            <p role="alert" className="alert error">
              {error}
            </p>
          )}
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              try {
                if (setup) {
                  await api("/setup", "POST", Object.fromEntries(f));
                  setSetup(false);
                  setNotice("Administrateur créé. Vous pouvez vous connecter.");
                } else {
                  const result = await api(
                    "/auth/login",
                    "POST",
                    Object.fromEntries(f),
                  );
                  setCsrf(result.csrf);
                  await load();
                  setError("");
                }
              } catch (e) {
                handleError(e);
              }
            }}
          >
            {setup && (
              <>
                <Field label="Nom complet">
                  <input name="name" required maxLength={200} />
                </Field>
                <Field label="Jeton d’installation">
                  <input
                    name="token"
                    type="password"
                    required
                    autoComplete="off"
                  />
                  <small>Présent dans /etc/electroplan/electroplan.env.</small>
                </Field>
              </>
            )}
            <Field label="Adresse e-mail">
              <input
                name="email"
                type="email"
                required
                autoComplete="username"
              />
            </Field>
            <Field label="Mot de passe">
              <input
                name="password"
                type="password"
                required
                minLength={setup ? 12 : 1}
                maxLength={128}
                autoComplete={setup ? "new-password" : "current-password"}
              />
            </Field>
            <Button type="submit">
              {setup ? "Créer mon installation" : "Se connecter"} <span>→</span>
            </Button>
          </form>
          {notice && <p role="status">{notice}</p>}
          <footer>Vos données restent sur votre serveur.</footer>
        </section>
      </div>
    );
  const titles: Record<string, string> = {
    dashboard: "Vue d’ensemble",
    locations: "Patrimoine",
    documents: "Bibliothèque documentaire",
    clients: "Clients",
    audit: "Journal d’audit",
    users: "Utilisateurs",
    admin: "Administration",
    account: "Mon compte",
  };
  return (
    <div className="shell">
      <aside>
        <Logo />
        <div className="workspace">
          <span className="workspace-icon">E</span>
          <div>
            {context.organization}
            <small>{context.license.edition} · Réseau local</small>
          </div>
        </div>
        <p className="nav-label">ESPACE DE TRAVAIL</p>
        <nav>
          {[
            ["dashboard", "◫", "Vue d’ensemble"],
            ["locations", "▦", "Patrimoine"],
            ["documents", "▤", "Documents"],
            ...(can("audit:read") ? [["audit", "≡", "Journal d’audit"]] : []),
            ...(context.user.role === "ADMIN"
              ? [
                  ["clients", "◇", "Clients"],
                  ["users", "♙", "Utilisateurs"],
                  ["admin", "⚙", "Administration"],
                ]
              : []),
          ].map(([key, icon, label]) => (
            <button
              key={key}
              className={page === key ? "active" : ""}
              onClick={() => {
                setPage(key);
                setSelectedDoc(null);
                setError("");
              }}
            >
              <span>{icon}</span>
              {label}
              {page === key && <b>•</b>}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <span className="local-dot" /> Hébergé sur votre serveur
          <button className="profile" onClick={() => setPage("account")}>
            <span className="avatar">
              {context.user.name.slice(0, 2).toUpperCase()}
            </span>
            <span>
              {context.user.name}
              <small>{labels[context.user.role]}</small>
            </span>
            <span>↗</span>
          </button>
        </div>
      </aside>
      <div className="main">
        <header>
          <div className="breadcrumb">
            Espace de travail <span>/</span> <strong>{titles[page]}</strong>
          </div>
          <div className="header-actions">
            <button
              className="icon"
              title="Changer de thème"
              aria-label="Changer de thème"
              onClick={() => setTheme(theme === "light" ? "dark" : "light")}
            >
              {theme === "light" ? "☾" : "☀"}
            </button>
            <button
              className="icon"
              title="Déconnexion"
              aria-label="Déconnexion"
              onClick={async () => {
                await api("/auth/logout", "POST");
                setContext(null);
              }}
            >
              ↪
            </button>
          </div>
        </header>
        <main>
          <div className="page-heading">
            <div>
              <p className="eyebrow">
                ELECTROPLAN / {titles[page].toUpperCase()}
              </p>
              <h1>{titles[page]}</h1>
              <p className="muted">
                {page === "dashboard"
                  ? "Gardez une vue claire sur votre patrimoine et votre documentation technique."
                  : page === "documents"
                    ? "Tous vos plans, révisions et documents techniques, centralisés."
                    : page === "locations"
                      ? "Organisez vos sites, bâtiments et équipements."
                      : "Gérez votre installation en toute simplicité."}
              </p>
            </div>
            <span className="pill">
              <span className="local-dot" /> Installation locale
            </span>
          </div>
          {error && (
            <div role="alert" className="alert error">
              {error}
              <button onClick={() => setError("")}>×</button>
            </div>
          )}
          {notice && (
            <div role="status" className="alert success">
              {notice}
              <button onClick={() => setNotice("")}>×</button>
            </div>
          )}
          {page === "dashboard" && (
            <Dashboard
              key={refresh}
              openDoc={(id) => {
                setSelectedDoc(id);
                setPage("documents");
              }}
              go={setPage}
              onError={handleError}
            />
          )}
          {page === "locations" && (
            <Locations
              key={refresh}
              locations={locations}
              clients={clients}
              selected={locationId}
              select={setLocationId}
              canWrite={can("locations:write")}
              admin={context.user.role === "ADMIN"}
              notify={notify}
              onError={handleError}
              openDocuments={(id) => {
                setLocationId(id);
                setSelectedDoc(null);
                setPage("documents");
              }}
            />
          )}
          {page === "documents" &&
            (selectedDoc ? (
              <DocumentDetail
                key={`${selectedDoc}-${refresh}`}
                id={selectedDoc}
                locations={locations}
                clients={clients}
                can={can}
                back={() => setSelectedDoc(null)}
                notify={notify}
                onError={handleError}
              />
            ) : (
              <Documents
                key={refresh}
                locations={locations}
                initialLocation={locationId}
                clients={clients}
                canWrite={can("documents:write")}
                canDownload={can("documents:download")}
                open={setSelectedDoc}
                notify={notify}
                onError={handleError}
              />
            ))}
          {page === "clients" && (
            <Clients
              key={refresh}
              locations={locations}
              notify={notify}
              onError={handleError}
            />
          )}
          {page === "audit" && <Audit onError={handleError} />}
          {page === "users" && (
            <Users
              key={refresh}
              locations={locations}
              notify={notify}
              onError={handleError}
            />
          )}
          {page === "admin" && (
            <Admin
              key={refresh}
              notify={notify}
              onError={handleError}
              logout={() => {
                setContext(null);
                setNotice("Restauration terminée. Reconnectez-vous.");
              }}
            />
          )}
          {page === "account" && (
            <section className="card narrow">
              <h2>Changer mon mot de passe</h2>
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  try {
                    await api(
                      "/auth/password",
                      "POST",
                      Object.fromEntries(new FormData(e.currentTarget)),
                    );
                    setContext(null);
                    setNotice("Mot de passe changé. Reconnectez-vous.");
                  } catch (e) {
                    handleError(e);
                  }
                }}
              >
                <Field label="Mot de passe actuel">
                  <input
                    name="current"
                    type="password"
                    required
                    autoComplete="current-password"
                  />
                </Field>
                <Field label="Nouveau mot de passe (12 caractères minimum)">
                  <input
                    name="password"
                    type="password"
                    required
                    minLength={12}
                    maxLength={128}
                    autoComplete="new-password"
                  />
                </Field>
                <Button>Enregistrer</Button>
              </form>
            </section>
          )}
          <footer className="main-footer">
            ElectroPlan <span>Documentation technique & patrimoine</span>
          </footer>
        </main>
      </div>
    </div>
  );
}
function Logo() {
  return (
    <div className="logo">
      <span className="logo-mark">ϟ</span>Electro<span>Plan</span>
    </div>
  );
}
type Feedback = { notify: (s: string) => void; onError: (e: unknown) => void };
function Dashboard({
  openDoc,
  go,
  onError,
}: {
  openDoc: (id: string) => void;
  go: (s: string) => void;
  onError: (e: unknown) => void;
}) {
  const [data, setData] = useState<any>(null);
  useEffect(() => {
    api("/dashboard").then(setData).catch(onError);
  }, []);
  if (!data) return <p>Chargement des indicateurs…</p>;
  const count = (kind: string) =>
    data.locations.find((l: any) => l.kind === kind)?._count || 0;
  return (
    <>
      <div className="stats">
        {[
          ["▤", "Documents", data.documents, "Votre bibliothèque technique"],
          [
            "▦",
            "Sites & bâtiments",
            count("SITE") + count("BUILDING"),
            "Un patrimoine organisé",
          ],
          [
            "ϟ",
            "Équipements",
            count("EQUIPMENT") + count("PANEL"),
            "Tableaux et équipements",
          ],
          ["⌖", "Locaux", count("ROOM"), "Des plans au bon endroit"],
        ].map(([icon, label, value, sub]) => (
          <section className="card stat" key={label}>
            <div className="stat-label">
              {label}
              <span>{icon}</span>
            </div>
            <strong>{value}</strong>
            <small>{sub}</small>
          </section>
        ))}
      </div>
      <div className="dashboard-grid">
        <section className="card">
          <div className="section-head">
            <div>
              <h2>Documents récents</h2>
              <p className="muted">
                Les dernières mises à jour de votre bibliothèque
              </p>
            </div>
            <button className="text-button" onClick={() => go("documents")}>
              Tout voir →
            </button>
          </div>
          {!data.recent.length ? (
            <Empty>
              Votre bibliothèque est prête à accueillir vos premiers plans.
            </Empty>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>DOCUMENT</th>
                    <th>LOCALISATION</th>
                    <th>STATUT</th>
                    <th>MODIFIÉ LE</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recent.map((d: any) => (
                    <tr
                      key={d.id}
                      onClick={() => openDoc(d.id)}
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") openDoc(d.id);
                      }}
                    >
                      <td>
                        <div className="document-name">
                          <span className="file-icon">▤</span>
                          <div>
                            <strong>{d.name}</strong>
                            <small>{d.reference}</small>
                          </div>
                        </div>
                      </td>
                      <td>{d.location.name}</td>
                      <td>
                        <Status value={d.status} />
                      </td>
                      <td>{formatDate(d.updatedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
        <section className="card activity">
          <div className="section-head">
            <h2>Dernière activité</h2>
            <span className="pill">Journal</span>
          </div>
          {data.activity.length ? (
            data.activity.map((a: any) => (
              <div className="activity-item" key={a.id}>
                <span className="activity-dot" />
                <div>
                  <strong>{actionLabel(a.action)}</strong>
                  <small>{a.actor}</small>
                  <time>{formatDate(a.createdAt)}</time>
                </div>
              </div>
            ))
          ) : (
            <Empty>Aucune activité sur vos sites.</Empty>
          )}
        </section>
      </div>
      <section className="welcome">
        <div className="welcome-symbol">▦</div>
        <div>
          <p className="eyebrow">UNE DOCUMENTATION QUI SUIT VOTRE TERRAIN</p>
          <h2>Chaque équipement. Le bon plan.</h2>
          <p>
            Structurez votre patrimoine et accédez à vos fiches sur site grâce
            aux QR codes.
          </p>
        </div>
        <button onClick={() => go("locations")}>
          Explorer le patrimoine →
        </button>
      </section>
    </>
  );
}
const actionLabel = (s: string) =>
  (
    ({
      login: "Connexion",
      "login.failed": "Connexion refusée",
      "document.create": "Fiche créée",
      "document.update": "Fiche modifiée",
      "document.delete": "Document supprimé",
      "document.download": "Téléchargement",
      "document.preview": "Consultation",
      "version.upload": "Nouvelle révision",
      "version.restore": "Version restaurée",
      "location.create": "Localisation créée",
      "location.update": "Localisation modifiée",
      "location.delete": "Localisation supprimée",
      "backup.create": "Sauvegarde créée",
      "backup.restore": "Sauvegarde restaurée",
      "user.create": "Compte créé",
      "user.update": "Compte modifié",
      setup: "Installation initialisée",
      "settings.update": "Paramètres modifiés",
      "license.activate": "Licence activée",
      "password.change": "Mot de passe changé",
      "client.create": "Client créé",
      "client.update": "Client modifié",
    }) as Record<string, string>
  )[s] || s;
function Status({ value }: { value: string }) {
  return (
    <span
      className={`status ${value === "En vigueur" ? "green" : value === "À valider" ? "amber" : "gray"}`}
    >
      {value}
    </span>
  );
}
function LocationOptions({ locations }: { locations: Location[] }) {
  return (
    <>
      {locations.map((l) => (
        <option key={l.id} value={l.id}>
          {labels[l.kind]} · {locationPath(l, locations)}
        </option>
      ))}
    </>
  );
}
function locationPath(l: Location, locations: Location[]): string {
  const parent = locations.find((p) => p.id === l.parentId);
  return parent ? `${locationPath(parent, locations)} / ${l.name}` : l.name;
}
function Locations({
  locations,
  clients,
  selected,
  select,
  canWrite,
  admin,
  notify,
  onError,
  openDocuments,
}: Feedback & {
  locations: Location[];
  clients: Client[];
  selected: string;
  select: (id: string) => void;
  canWrite: boolean;
  admin: boolean;
  openDocuments: (id: string) => void;
}) {
  const [modal, setModal] = useState(false),
    [editing, setEditing] = useState(false),
    [kind, setKind] = useState("BUILDING"),
    [parentId, setParentId] = useState(""),
    [clientChoice, setClientChoice] = useState("inherit"),
    [qr, setQr] = useState(false),
    [query, setQuery] = useState(""),
    [kindFilter, setKindFilter] = useState("");
  const { matches, visible } = searchPatrimony(
      locations,
      clients,
      query,
      kindFilter,
    ),
    filtering = !!query.trim() || !!kindFilter;
  const current = locations.find((l) => l.id === selected),
    roots = locations.filter((l) => !l.parentId);
  function tree(l: Location, depth = 0): ReactNode {
    if (!visible.has(l.id)) return null;
    return (
      <React.Fragment key={l.id}>
        <button
          className={`tree-item ${selected === l.id ? "selected" : ""} ${filtering && matches.has(l.id) ? "search-match" : ""}`}
          style={{ paddingLeft: 16 + depth * 18 }}
          onClick={() => select(l.id)}
        >
          <span>
            {l.kind === "SITE" ? "◈" : l.kind === "PANEL" ? "ϟ" : "▦"}
          </span>
          {l.name}
          <small>{labels[l.kind]}</small>
        </button>
        {locations
          .filter((c) => c.parentId === l.id)
          .map((c) => tree(c, depth + 1))}
      </React.Fragment>
    );
  }
  return (
    <>
      <div className="toolbar">
        <span>{locations.length} éléments dans votre patrimoine</span>
        {canWrite && (
          <Button
            onClick={() => {
              setEditing(false);
              setKind(admin ? "SITE" : "BUILDING");
              setParentId(selected);
              setClientChoice("inherit");
              setModal(true);
            }}
          >
            + Ajouter une localisation
          </Button>
        )}
      </div>
      <div className="patrimony-grid">
        <section className="card tree">
          <div className="section-head">
            <h2>Arborescence</h2>
            <span className="pill">{roots.length} sites</span>
          </div>
          <div className="patrimony-search">
            <Field label="Rechercher dans le patrimoine">
              <input
                placeholder="Nom, référence, description, client…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </Field>
            <Field label="Type d’élément">
              <select
                value={kindFilter}
                onChange={(e) => setKindFilter(e.target.value)}
              >
                <option value="">Tous les types</option>
                {[
                  "SITE",
                  "BUILDING",
                  "FLOOR",
                  "ZONE",
                  "ROOM",
                  "PANEL",
                  "EQUIPMENT",
                ].map((kind) => (
                  <option key={kind} value={kind}>
                    {labels[kind]}
                  </option>
                ))}
              </select>
            </Field>
            {filtering && (
              <div className="button-row">
                <span role="status">
                  {matches.size} résultat{matches.size === 1 ? "" : "s"}
                </span>
                <button
                  className="text-button"
                  onClick={() => {
                    setQuery("");
                    setKindFilter("");
                  }}
                >
                  Effacer la recherche
                </button>
              </div>
            )}
          </div>
          {filtering && !matches.size ? (
            <Empty>
              Aucun élément correspondant. Modifiez votre recherche.
            </Empty>
          ) : roots.length ? (
            roots.map((l) => tree(l))
          ) : (
            <Empty>Créez votre premier site pour commencer.</Empty>
          )}
        </section>
        <section className="card">
          {current ? (
            <>
              <p className="eyebrow">{labels[current.kind]}</p>
              <h2>{current.name}</h2>
              <p className="muted">{locationPath(current, locations)}</p>
              <dl>
                <dt>Référence</dt>
                <dd>{current.reference || "Non renseignée"}</dd>
                <dt>Client applicable</dt>
                <dd>
                  {clients.find(
                    (c) =>
                      c.id === effectiveClient(locations, current.id).clientId,
                  )?.name || "Aucun client rattaché"}
                </dd>
                <dt>Description</dt>
                <dd>{current.description || "Aucune description"}</dd>
                <dt>Identifiant</dt>
                <dd className="mono">{current.id}</dd>
              </dl>
              <div className="button-row">
                <Button onClick={() => openDocuments(current.id)}>
                  Voir les documents
                </Button>
                <Button className="secondary" onClick={() => setQr(true)}>
                  QR code
                </Button>
                {canWrite && (
                  <>
                    <Button
                      className="secondary"
                      onClick={() => {
                        setEditing(true);
                        setKind(current.kind);
                        setParentId(current.parentId || "");
                        setClientChoice(
                          current.clientId ||
                            (current.inheritClient === false
                              ? "none"
                              : "inherit"),
                        );
                        setModal(true);
                      }}
                    >
                      Modifier
                    </Button>
                    <Button
                      className="danger"
                      onClick={async () => {
                        if (
                          !confirm(
                            "Supprimer cette localisation ? Elle doit être vide.",
                          )
                        )
                          return;
                        try {
                          await api(`/locations/${current.id}`, "DELETE");
                          select("");
                          notify("Localisation supprimée.");
                        } catch (e) {
                          onError(e);
                        }
                      }}
                    >
                      Supprimer
                    </Button>
                  </>
                )}
              </div>
            </>
          ) : (
            <Empty>
              Sélectionnez une localisation pour consulter sa fiche.
            </Empty>
          )}
        </section>
      </div>
      {modal && (
        <Modal
          title={
            editing ? "Modifier la localisation" : "Ajouter une localisation"
          }
          close={() => setModal(false)}
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const f = Object.fromEntries(new FormData(e.currentTarget));
              try {
                const result = await api(
                  editing ? `/locations/${current!.id}` : "/locations",
                  editing ? "PATCH" : "POST",
                  {
                    ...f,
                    kind,
                    parentId: kind === "SITE" ? null : parentId || null,
                    ...(admin
                      ? {
                          clientId: ["inherit", "none"].includes(clientChoice)
                            ? null
                            : clientChoice,
                          inheritClient: clientChoice === "inherit",
                        }
                      : {}),
                  },
                );
                select(result.id);
                setModal(false);
                notify("Localisation enregistrée.");
              } catch (e) {
                onError(e);
              }
            }}
          >
            <Field label="Nom">
              <input
                name="name"
                defaultValue={editing ? current?.name : ""}
                required
                maxLength={200}
              />
            </Field>
            <Field label="Référence">
              <input
                name="reference"
                defaultValue={editing ? current?.reference : ""}
                maxLength={100}
              />
            </Field>
            <Field label="Type">
              <select
                value={kind}
                onChange={(e) => {
                  const next = e.target.value;
                  setKind(next);
                  if (
                    next === "SITE" ||
                    !allowedParents[next].includes(
                      locations.find((l) => l.id === parentId)?.kind || "",
                    )
                  )
                    setParentId("");
                }}
              >
                {locationKinds
                  .filter(
                    (k) =>
                      admin ||
                      k !== "SITE" ||
                      (editing && current?.kind === "SITE"),
                  )
                  .map((k) => (
                    <option key={k} value={k}>
                      {labels[k]}
                    </option>
                  ))}
              </select>
              <small>
                Le type doit rester compatible avec les enfants et les
                associations existants.
              </small>
            </Field>
            {kind !== "SITE" && (
              <Field label="Parent">
                <select
                  value={parentId}
                  onChange={(e) => setParentId(e.target.value)}
                  required
                >
                  <option value="">Choisir…</option>
                  <LocationOptions
                    locations={locations.filter(
                      (l) =>
                        allowedParents[kind].includes(l.kind) &&
                        (!editing ||
                          !descendantIds(locations, current!.id).has(l.id)),
                    )}
                  />
                </select>
              </Field>
            )}
            {admin && (
              <Field label="Client du site / bâtiment">
                <select
                  value={clientChoice}
                  onChange={(e) => setClientChoice(e.target.value)}
                >
                  <option value="inherit">
                    {kind === "SITE"
                      ? "Sans client (site)"
                      : "Hériter du parent"}
                  </option>
                  <option value="none">Sans client · références libres</option>
                  {clients
                    .filter((c) => c.active || c.id === current?.clientId)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} · {c.prefix}
                      </option>
                    ))}
                </select>
                <small>
                  Modifiable à tout moment. Ce choix s’applique aux futurs
                  documents et aux descendants qui héritent. Les documents
                  existants conservent leur client et leur référence ; leur
                  fiche permet de les réaffecter explicitement.
                </small>
              </Field>
            )}
            <Field label="Description">
              <textarea
                name="description"
                defaultValue={editing ? current?.description : ""}
                maxLength={5000}
              />
            </Field>
            <Button>Enregistrer</Button>
          </form>
        </Modal>
      )}
      {qr && current && (
        <Modal title={`QR code · ${current.name}`} close={() => setQr(false)}>
          <div className="qr">
            <img
              src={`/api/locations/${current.id}/qr`}
              alt={`QR code de ${current.name}`}
            />
            <p>
              Scannez pour ouvrir cette fiche. Une connexion au réseau et une
              authentification sont nécessaires.
            </p>
            <a
              className="button"
              download={`qr-${current.id}.png`}
              href={`/api/locations/${current.id}/qr`}
            >
              Télécharger le QR code
            </a>
          </div>
        </Modal>
      )}
    </>
  );
}
function DocumentForm({
  locations,
  clients,
  initial,
  onSubmit,
}: {
  locations: Location[];
  clients: Client[];
  initial?: any;
  onSubmit: (data: any) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false),
    [locationId, setLocationId] = useState(initial?.locationId || ""),
    [reference, setReference] = useState(initial?.reference || ""),
    [documentClient, setDocumentClient] = useState<string>(
      initial ? initial.clientId || "none" : "auto",
    ),
    [regenerate, setRegenerate] = useState(false);
  const clientId =
    documentClient === "auto"
      ? effectiveClient(locations, locationId).clientId
      : documentClient === "none"
        ? null
        : documentClient;
  const client = clients.find((c) => c.id === clientId),
    managed = !!clientId,
    newReference =
      managed && (!initial || clientId !== initial.clientId || regenerate);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget),
          data = Object.fromEntries(f);
        setBusy(true);
        try {
          await onSubmit({
            ...data,
            regenerateReference: regenerate && managed,
            ...(documentClient === "auto"
              ? { useLocationClient: true }
              : {
                  useLocationClient: false,
                  clientId: documentClient === "none" ? null : documentClient,
                }),
            tags: String(data.tags)
              .split(",")
              .map((t) => t.trim())
              .filter(Boolean),
            equipmentIds: f.getAll("equipmentIds"),
          });
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="form-grid">
        <Field label="Nom du document">
          <input
            name="name"
            defaultValue={initial?.name}
            required
            maxLength={200}
          />
        </Field>
        <Field label="Référence">
          <input
            name="reference"
            value={newReference ? "" : reference}
            onChange={(e) => setReference(e.target.value)}
            readOnly={managed}
            placeholder={
              managed
                ? `${client?.prefix || initial?.client?.prefix}-… (automatique)`
                : ""
            }
            required={!managed}
            maxLength={200}
          />
          {managed && (
            <small>
              {newReference
                ? `Nouvelle référence attribuée pour ${client?.name}. ${initial ? "L’ancienne référence reste dans l’historique." : ""}`
                : "Référence conservée. Un changement de client permet de générer une nouvelle référence."}
            </small>
          )}
        </Field>
        <Field label="Localisation">
          <select
            name="locationId"
            value={locationId}
            onChange={(e) => setLocationId(e.target.value)}
            required
          >
            <option value="">Choisir…</option>
            <LocationOptions locations={locations} />
          </select>
        </Field>
        <Field label="Client du document">
          <select
            value={documentClient}
            onChange={(e) => setDocumentClient(e.target.value)}
          >
            <option value="auto">Utiliser le client de la localisation</option>
            <option value="none">Sans client · référence libre</option>
            {clients
              .filter((c) => c.active || c.id === initial?.clientId)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} · {c.prefix}
                </option>
              ))}
          </select>
          <small>
            {initial
              ? "Changer le client attribue une nouvelle référence automatiquement et conserve l’ancienne dans l’historique."
              : "Le choix automatique suit le client du bâtiment ou du parent le plus proche."}
          </small>
        </Field>
        {initial && managed && (
          <label className="check">
            <input
              type="checkbox"
              checked={regenerate}
              onChange={(e) => setRegenerate(e.target.checked)}
            />
            Attribuer une nouvelle référence (ancienne conservée dans
            l’historique)
          </label>
        )}
        <Field label="Catégorie">
          <input
            name="category"
            defaultValue={initial?.category || "Plan électrique"}
            required
            maxLength={200}
            list="categories"
          />
          <datalist id="categories">
            <option>Plan électrique</option>
            <option>Schéma unifilaire</option>
            <option>Notice technique</option>
            <option>Rapport de contrôle</option>
          </datalist>
        </Field>
        <Field label="Installation">
          <select
            name="installationType"
            defaultValue={initial?.installationType || "Électricité"}
          >
            {[
              "Électricité",
              "HVAC",
              "Plomberie",
              "Incendie",
              "Réseaux informatiques",
            ].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </Field>
        <Field label="Type de bâtiment">
          <input
            name="buildingType"
            defaultValue={initial?.buildingType || ""}
            maxLength={100}
            placeholder="Tertiaire, résidentiel, industriel…"
          />
        </Field>
        <Field label="Statut">
          <select name="status" defaultValue={initial?.status || "Brouillon"}>
            {["Brouillon", "À valider", "En vigueur", "Archivé"].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </Field>
        <Field label="Date du plan">
          <input name="planDate" type="date" defaultValue={initial?.planDate} />
        </Field>
      </div>
      <Field label="Tags (séparés par des virgules)">
        <input
          name="tags"
          defaultValue={initial?.tags?.join(", ")}
          maxLength={1500}
        />
      </Field>
      <Field label="Équipements associés (Ctrl/Cmd pour plusieurs)">
        <select
          name="equipmentIds"
          multiple
          defaultValue={
            initial?.equipment?.map((e: any) => e.equipmentId) || []
          }
        >
          <LocationOptions
            locations={locations.filter((l) =>
              ["PANEL", "EQUIPMENT"].includes(l.kind),
            )}
          />
        </select>
      </Field>
      <Field label="Description">
        <textarea
          name="description"
          defaultValue={initial?.description || ""}
          maxLength={5000}
        />
      </Field>
      <Button disabled={busy}>
        {busy ? "Enregistrement…" : "Enregistrer la fiche"}
      </Button>
    </form>
  );
}
function Documents({
  locations,
  clients,
  initialLocation,
  canWrite,
  canDownload,
  open,
  notify,
  onError,
}: Feedback & {
  locations: Location[];
  clients: Client[];
  initialLocation: string;
  canWrite: boolean;
  canDownload: boolean;
  open: (id: string) => void;
}) {
  const [data, setData] = useState<any>(null),
    [filters, setFilters] = useState<Record<string, string>>({
      locationId: initialLocation,
    }),
    [page, setPage] = useState(1),
    [modal, setModal] = useState(false),
    [reader, setReader] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      const params = new URLSearchParams(
        Object.entries({ ...filters, page: String(page) }).filter(([, v]) => v),
      );
      api(`/documents?${params}`)
        .then((result) => {
          if (!controller.signal.aborted) setData(result);
        })
        .catch(onError);
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [filters, page]);
  const filter = (key: string, value: string) => {
    setPage(1);
    setFilters((f) => ({ ...f, [key]: value }));
  };
  return (
    <>
      <div className="toolbar">
        <span>{data?.total || 0} documents</span>
        <div className="button-row">
          <Button className="secondary" onClick={() => setReader(true)}>
            Lecteur de plans
          </Button>
          {canWrite && (
            <Button onClick={() => setModal(true)}>+ Nouveau document</Button>
          )}
        </div>
      </div>
      {reader && (
        <React.Suspense fallback={<p role="status">Chargement du lecteur…</p>}>
          <DocumentReader
            locations={locations}
            canDownload={canDownload}
            close={() => setReader(false)}
          />
        </React.Suspense>
      )}
      <section className="card filters">
        <div className="search">
          <span>⌕</span>
          <input
            aria-label="Rechercher des documents"
            placeholder="Rechercher un nom, une référence ou le texte d’un PDF…"
            value={filters.q || ""}
            onChange={(e) => filter("q", e.target.value)}
          />
        </div>
        <div className="filter-row">
          <select
            aria-label="Filtrer par client"
            value={filters.clientId || ""}
            onChange={(e) => filter("clientId", e.target.value)}
          >
            <option value="">Tous les clients</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <select
            aria-label="Filtrer par site"
            value={filters.siteId || ""}
            onChange={(e) => filter("siteId", e.target.value)}
          >
            <option value="">Tous les sites</option>
            <LocationOptions
              locations={locations.filter((l) => l.kind === "SITE")}
            />
          </select>
          <select
            aria-label="Filtrer par localisation"
            value={filters.locationId || ""}
            onChange={(e) => filter("locationId", e.target.value)}
          >
            <option value="">Toutes les localisations</option>
            <LocationOptions locations={locations} />
          </select>
          <select
            aria-label="Filtrer par statut"
            value={filters.status || ""}
            onChange={(e) => filter("status", e.target.value)}
          >
            <option value="">Tous les statuts</option>
            {["Brouillon", "À valider", "En vigueur", "Archivé"].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          <button className="text-button" onClick={() => setFilters({})}>
            Réinitialiser
          </button>
        </div>
        <details>
          <summary>Filtres avancés</summary>
          <div className="form-grid">
            {[
              ["category", "Catégorie"],
              ["tag", "Tag"],
              ["buildingType", "Type de bâtiment"],
            ].map(([key, label]) => (
              <Field key={key} label={label}>
                <input
                  value={filters[key] || ""}
                  onChange={(e) => filter(key, e.target.value)}
                />
              </Field>
            ))}
            <Field label="Installation">
              <select
                value={filters.installationType || ""}
                onChange={(e) => filter("installationType", e.target.value)}
              >
                <option value="">Toutes</option>
                {[
                  "Électricité",
                  "HVAC",
                  "Plomberie",
                  "Incendie",
                  "Réseaux informatiques",
                ].map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </Field>
            <Field label="Équipement">
              <select
                value={filters.equipmentId || ""}
                onChange={(e) => filter("equipmentId", e.target.value)}
              >
                <option value="">Tous</option>
                <LocationOptions
                  locations={locations.filter((l) =>
                    ["PANEL", "EQUIPMENT"].includes(l.kind),
                  )}
                />
              </select>
            </Field>
            <Field label="Du">
              <input
                type="date"
                value={filters.dateFrom || ""}
                onChange={(e) => filter("dateFrom", e.target.value)}
              />
            </Field>
            <Field label="Au">
              <input
                type="date"
                value={filters.dateTo || ""}
                onChange={(e) => filter("dateTo", e.target.value)}
              />
            </Field>
          </div>
        </details>
      </section>
      <section className="card">
        {data?.items.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>DOCUMENT / RÉFÉRENCE</th>
                  <th>LOCALISATION</th>
                  <th>CATÉGORIE</th>
                  <th>RÉVISION</th>
                  <th>STATUT</th>
                  <th>MISE À JOUR</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((d: any) => (
                  <tr
                    key={d.id}
                    onClick={() => open(d.id)}
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") open(d.id);
                    }}
                  >
                    <td>
                      <div className="document-name">
                        <span className="file-icon">▤</span>
                        <div>
                          <strong>{d.name}</strong>
                          <small>{d.reference}</small>
                          {d.client && <small>{d.client.name}</small>}
                        </div>
                      </div>
                    </td>
                    <td>{d.location.name}</td>
                    <td>{d.category}</td>
                    <td>
                      {d.versions.find((v: any) => v.id === d.currentVersionId)
                        ?.revision || "Sans fichier"}
                    </td>
                    <td>
                      <Status value={d.status} />
                    </td>
                    <td>{formatDate(d.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>
            {data
              ? "Aucun document ne correspond à votre recherche."
              : "Chargement des documents…"}
          </Empty>
        )}
        <div className="pagination">
          <button
            className="secondary"
            disabled={page === 1}
            onClick={() => setPage((p) => p - 1)}
          >
            ← Précédent
          </button>
          <span>
            Page {page} · {data?.total || 0} résultats
          </span>
          <button
            className="secondary"
            disabled={!data || page * 30 >= data.total}
            onClick={() => setPage((p) => p + 1)}
          >
            Suivant →
          </button>
        </div>
      </section>
      {modal && (
        <Modal title="Nouvelle fiche de plan" close={() => setModal(false)}>
          <DocumentForm
            locations={locations}
            clients={clients}
            onSubmit={async (data) => {
              try {
                const result = await api("/documents", "POST", data);
                setModal(false);
                notify(
                  "Fiche créée. Ajoutez maintenant le fichier de la première révision.",
                );
                open(result.id);
              } catch (e) {
                onError(e);
              }
            }}
          />
        </Modal>
      )}
    </>
  );
}
function DocumentDetail({
  id,
  locations,
  clients,
  can,
  back,
  notify,
  onError,
}: Feedback & {
  id: string;
  locations: Location[];
  clients: Client[];
  can: (p: string) => boolean;
  back: () => void;
}) {
  const [doc, setDoc] = useState<any>(null),
    [editing, setEditing] = useState(false),
    [uploading, setUploading] = useState(false),
    [preview, setPreview] = useState<any>(null);
  useEffect(() => {
    api(`/documents/${id}`).then(setDoc).catch(onError);
  }, [id]);
  if (!doc) return <p>Chargement de la fiche…</p>;
  const current = doc.versions.find((v: any) => v.id === doc.currentVersionId);
  return (
    <>
      <button className="text-button" onClick={back}>
        ← Retour aux documents
      </button>
      <section className="card">
        <div className="section-head">
          <div>
            <p className="eyebrow">{doc.reference}</p>
            <h2>{doc.name}</h2>
            <p className="muted">{locationPath(doc.location, locations)}</p>
          </div>
          <Status value={doc.status} />
        </div>
        <div className="button-row">
          {current && (
            <>
              {["application/pdf", "image/png", "image/jpeg"].includes(
                current.mime,
              ) && (
                <Button onClick={() => setPreview(current)}>
                  Prévisualiser
                </Button>
              )}
              {can("documents:download") && (
                <a
                  className="button secondary"
                  href={`/api/documents/${id}/versions/${current.id}/file`}
                >
                  Télécharger la version en vigueur
                </a>
              )}
            </>
          )}
          {can("documents:write") && (
            <Button className="secondary" onClick={() => setEditing(true)}>
              Modifier la fiche
            </Button>
          )}
          {can("documents:delete") && (
            <Button
              className="danger"
              onClick={async () => {
                if (!confirm("Supprimer cette fiche et tous ses fichiers ?"))
                  return;
                try {
                  await api(`/documents/${id}`, "DELETE");
                  back();
                  notify("Document supprimé.");
                } catch (e) {
                  onError(e);
                }
              }}
            >
              Supprimer
            </Button>
          )}
        </div>
        <dl className="metadata">
          {[
            ["Description", doc.description || "—"],
            ["Catégorie", doc.category],
            [
              "Client",
              doc.client?.name || "Sans client · référence libre ou historique",
            ],
            ["Installation", doc.installationType],
            ["Bâtiment", doc.buildingType || "—"],
            ["Date du plan", doc.planDate || "—"],
            ["Tags", doc.tags.join(", ") || "—"],
            [
              "Équipements",
              doc.equipment.map((e: any) => e.equipment.name).join(", ") || "—",
            ],
          ].map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
        {!!doc.referenceHistory?.length && (
          <details>
            <summary>
              Historique des références ({doc.referenceHistory.length})
            </summary>
            <ul>
              {doc.referenceHistory.map((entry: any, index: number) => (
                <li key={index}>
                  <strong>{entry.reference}</strong> ·{" "}
                  {entry.clientName || "Sans client"} ·{" "}
                  {formatDate(entry.changedAt)} · {entry.actor}
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>
      <section className="card">
        <div className="section-head">
          <div>
            <h2>Historique des révisions</h2>
            <p className="muted">
              Chaque fichier est conservé avec son empreinte et son auteur.
            </p>
          </div>
        </div>
        {can("documents:write") && (
          <form
            className="upload-form"
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget),
                revision = String(f.get("revision"));
              f.delete("revision");
              setUploading(true);
              try {
                await api(
                  `/documents/${id}/versions?revision=${encodeURIComponent(revision)}`,
                  "POST",
                  f,
                );
                notify(
                  "Nouvelle révision importée et définie comme version en vigueur.",
                );
              } catch (e) {
                onError(e);
              } finally {
                setUploading(false);
              }
            }}
          >
            <Field label="Révision">
              <input
                name="revision"
                placeholder="A, B, 1.0…"
                required
                maxLength={200}
              />
            </Field>
            <Field label="Fichier (50 Mo maximum)">
              <input
                name="file"
                type="file"
                required
                accept=".pdf,.png,.jpg,.jpeg,.dwg,.dxf"
              />
            </Field>
            <Button disabled={uploading}>
              {uploading ? "Importation…" : "Importer une révision"}
            </Button>
          </form>
        )}
        {doc.versions.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>RÉVISION</th>
                  <th>FICHIER</th>
                  <th>AUTEUR / DATE</th>
                  <th>ACTIONS</th>
                </tr>
              </thead>
              <tbody>
                {doc.versions.map((v: any) => (
                  <tr key={v.id}>
                    <td>
                      <strong>{v.revision}</strong>
                      {v.id === doc.currentVersionId && (
                        <span className="status green">En vigueur</span>
                      )}
                    </td>
                    <td>
                      {v.originalName}
                      <small>{bytes(v.size)}</small>
                      <details>
                        <summary>Empreinte SHA-256</summary>
                        <code className="hash">{v.sha256}</code>
                      </details>
                    </td>
                    <td>
                      {v.author}
                      <small>{formatDate(v.createdAt)}</small>
                    </td>
                    <td>
                      <div className="button-row">
                        {[
                          "application/pdf",
                          "image/png",
                          "image/jpeg",
                        ].includes(v.mime) && (
                          <button
                            className="text-button"
                            onClick={() => setPreview(v)}
                          >
                            Aperçu
                          </button>
                        )}
                        {can("documents:download") && (
                          <a
                            href={`/api/documents/${id}/versions/${v.id}/file`}
                          >
                            Télécharger
                          </a>
                        )}
                        {can("documents:write") &&
                          v.id !== doc.currentVersionId && (
                            <button
                              className="text-button"
                              onClick={async () => {
                                try {
                                  await api(
                                    `/documents/${id}/restore`,
                                    "POST",
                                    { versionId: v.id },
                                  );
                                  notify("Version en vigueur restaurée.");
                                } catch (e) {
                                  onError(e);
                                }
                              }}
                            >
                              Restaurer
                            </button>
                          )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>Aucun fichier. Importez la première révision.</Empty>
        )}
      </section>
      {editing && (
        <Modal title="Modifier la fiche" close={() => setEditing(false)}>
          <DocumentForm
            locations={locations}
            clients={clients}
            initial={doc}
            onSubmit={async (data) => {
              try {
                await api(`/documents/${id}`, "PUT", data);
                setEditing(false);
                notify("Fiche enregistrée.");
              } catch (e) {
                onError(e);
              }
            }}
          />
        </Modal>
      )}
      {preview && (
        <React.Suspense fallback={<p role="status">Chargement du lecteur…</p>}>
          <DocumentReader
            locations={locations}
            initialDocumentId={id}
            initialVersionId={preview.id}
            canDownload={can("documents:download")}
            close={() => setPreview(null)}
          />
        </React.Suspense>
      )}
    </>
  );
}
function Audit({ onError }: { onError: (e: unknown) => void }) {
  const [data, setData] = useState<any>(null),
    [page, setPage] = useState(1),
    [action, setAction] = useState("");
  useEffect(() => {
    api(`/audit?page=${page}&action=${encodeURIComponent(action)}`)
      .then(setData)
      .catch(onError);
  }, [page, action]);
  return (
    <section className="card">
      <Field label="Filtrer par action">
        <input
          placeholder="document, login, backup…"
          value={action}
          onChange={(e) => {
            setAction(e.target.value);
            setPage(1);
          }}
        />
      </Field>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>DATE</th>
              <th>UTILISATEUR</th>
              <th>ACTION</th>
              <th>CIBLE</th>
              <th>IP</th>
            </tr>
          </thead>
          <tbody>
            {data?.items.map((a: any) => (
              <tr key={a.id}>
                <td>{formatDate(a.createdAt)}</td>
                <td>{a.actor}</td>
                <td>{actionLabel(a.action)}</td>
                <td className="mono">{a.target}</td>
                <td>{a.ip}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data && !data.items.length && <Empty>Aucun événement.</Empty>}
      <div className="pagination">
        <button
          className="secondary"
          disabled={page === 1}
          onClick={() => setPage((p) => p - 1)}
        >
          Précédent
        </button>
        <span>
          {data?.total || 0} événements · page {page}
        </span>
        <button
          className="secondary"
          disabled={!data || page * 50 >= data.total}
          onClick={() => setPage((p) => p + 1)}
        >
          Suivant
        </button>
      </div>
    </section>
  );
}
function Users({
  locations,
  notify,
  onError,
}: Feedback & { locations: Location[] }) {
  const [users, setUsers] = useState<Account[]>([]),
    [editing, setEditing] = useState<Partial<Account> | null>(null);
  useEffect(() => {
    api<Account[]>("/users").then(setUsers).catch(onError);
  }, []);
  return (
    <>
      <div className="toolbar">
        <span>{users.length} comptes</span>
        <Button
          onClick={() =>
            setEditing({ role: "READER", permissions: [], siteIds: [] })
          }
        >
          + Nouvel utilisateur
        </Button>
      </div>
      <section className="card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>NOM</th>
                <th>E-MAIL</th>
                <th>RÔLE</th>
                <th>ACCÈS</th>
                <th>STATUT</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>{u.name}</td>
                  <td>{u.email}</td>
                  <td>{labels[u.role]}</td>
                  <td>
                    {u.role === "ADMIN"
                      ? "Tous les sites"
                      : u.siteIds
                          .map((id) => locations.find((l) => l.id === id)?.name)
                          .join(", ") || "Aucun site"}
                  </td>
                  <td>{u.active ? "Actif" : "Désactivé"}</td>
                  <td>
                    <button
                      className="text-button"
                      onClick={() => setEditing(u)}
                    >
                      Modifier
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {editing && (
        <Modal
          title={editing.id ? "Modifier le compte" : "Créer un compte"}
          close={() => setEditing(null)}
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              const data: any = {
                ...Object.fromEntries(f),
                siteIds: f.getAll("siteIds"),
                permissions: f.getAll("permissions"),
              };
              if (!data.password) delete data.password;
              if (editing.id) data.active = f.get("active") === "on";
              try {
                await api(
                  editing.id ? `/users/${editing.id}` : "/users",
                  editing.id ? "PUT" : "POST",
                  data,
                );
                setEditing(null);
                notify(
                  "Compte enregistré. Les sessions précédentes ont été révoquées.",
                );
              } catch (e) {
                onError(e);
              }
            }}
          >
            <Field label="Nom">
              <input
                name="name"
                defaultValue={editing.name}
                required
                maxLength={200}
              />
            </Field>
            <Field label="E-mail">
              <input
                name="email"
                type="email"
                defaultValue={editing.email}
                required
              />
            </Field>
            <Field
              label={
                editing.id
                  ? "Nouveau mot de passe (laisser vide pour conserver)"
                  : "Mot de passe (12 caractères minimum)"
              }
            >
              <input
                name="password"
                type="password"
                autoComplete="new-password"
                minLength={12}
                maxLength={128}
                required={!editing.id}
              />
            </Field>
            <Field label="Rôle">
              <select name="role" defaultValue={editing.role}>
                {["READER", "EDITOR", "ADMIN"].map((r) => (
                  <option value={r} key={r}>
                    {labels[r]}
                  </option>
                ))}
              </select>
            </Field>
            <fieldset>
              <legend>
                Sites autorisés (administrateurs : tous les sites)
              </legend>
              {locations
                .filter((l) => l.kind === "SITE")
                .map((l) => (
                  <label className="check" key={l.id}>
                    <input
                      type="checkbox"
                      name="siteIds"
                      value={l.id}
                      defaultChecked={editing.siteIds?.includes(l.id)}
                    />
                    {l.name}
                  </label>
                ))}
            </fieldset>
            <fieldset>
              <legend>Permissions supplémentaires au rôle</legend>
              <p className="muted">
                Lecteur : consultation et téléchargement. Éditeur : gestion du
                patrimoine et des documents.
              </p>
              {Object.entries(permissionLabels).map(([p, label]) => (
                <label className="check" key={p}>
                  <input
                    type="checkbox"
                    name="permissions"
                    value={p}
                    defaultChecked={editing.permissions?.includes(p)}
                  />
                  {label}
                </label>
              ))}
            </fieldset>
            {editing.id && (
              <label className="check">
                <input
                  name="active"
                  type="checkbox"
                  defaultChecked={editing.active}
                />
                Compte actif
              </label>
            )}
            <Button>Enregistrer</Button>
          </form>
        </Modal>
      )}
    </>
  );
}
function Admin({ notify, onError, logout }: Feedback & { logout: () => void }) {
  const [data, setData] = useState<any>(null),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    api("/admin").then(setData).catch(onError);
  }, []);
  if (!data) return <p>Chargement de l’administration…</p>;
  return (
    <div className="admin-grid">
      <section className="card">
        <h2>Organisation</h2>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await api(
                "/admin/settings",
                "PUT",
                Object.fromEntries(new FormData(e.currentTarget)),
              );
              notify("Paramètres enregistrés.");
            } catch (e) {
              onError(e);
            }
          }}
        >
          <Field label="Nom de l’organisation">
            <input
              name="organization"
              required
              defaultValue={data.settings.organization || "Mon organisation"}
              maxLength={200}
            />
          </Field>
          <Field label="E-mail du support">
            <input
              name="supportEmail"
              type="email"
              defaultValue={data.settings.supportEmail || ""}
            />
          </Field>
          <Button>Enregistrer</Button>
        </form>
      </section>
      <section className="card">
        <h2>Serveur & stockage</h2>
        <dl>
          {[
            ["Système", data.server.platform],
            ["Node.js", data.server.node],
            ["Disponibilité", `${Math.floor(data.server.uptime / 60)} minutes`],
            ["Mémoire", bytes(data.server.memory)],
            [
              "Documents",
              `${data.storage.files} fichiers · ${bytes(data.storage.bytes)}`,
            ],
            ["Écoute", `${data.server.host}:${data.server.port}`],
            ["URL publique", data.server.publicUrl],
          ].map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
        <p className="muted">
          Le réseau se configure dans /etc/electroplan/electroplan.env puis par
          redémarrage du service.
        </p>
      </section>
      <section className="card">
        <h2>Licence {data.license.edition}</h2>
        <p>
          {data.license.customer ||
            "Édition Standard disponible sans activation."}
        </p>
        {data.license.error && (
          <p className="alert error">{data.license.error}</p>
        )}
        <Field label="Identifiant de cette installation">
          <input
            readOnly
            value={data.installationId}
            onFocus={(e) => e.currentTarget.select()}
          />
        </Field>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              const file = new FormData(e.currentTarget).get("license") as File;
              await api(
                "/admin/license",
                "POST",
                JSON.parse(await file.text()),
              );
              notify("Licence signée activée.");
            } catch (e) {
              onError(e);
            }
          }}
        >
          <Field label="Activer un fichier de licence hors ligne">
            <input name="license" type="file" accept=".json" required />
          </Field>
          <Button>Vérifier et activer</Button>
        </form>
      </section>
      <section className="card">
        <h2>Sauvegardes & restauration</h2>
        <p className="muted">
          Instantanés cohérents de la base SQLite et des fichiers. Sauvegardes
          locales à copier régulièrement sur un autre support.
        </p>
        <Button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await api("/admin/backups", "POST");
              notify("Sauvegarde créée dans le répertoire backups du serveur.");
            } catch (e) {
              onError(e);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Sauvegarde en cours…" : "Créer une sauvegarde"}
        </Button>
        {data.backups.length ? (
          <div className="backup-list">
            {data.backups.map((b: any) => (
              <div key={b.id}>
                <div>
                  <strong>{formatDate(b.createdAt)}</strong>
                  <small>
                    {b.files} fichiers · <code>{b.id}</code>
                  </small>
                </div>
                <button
                  className="danger"
                  disabled={busy}
                  onClick={async () => {
                    if (
                      prompt(
                        "Cette restauration remplacera la base et les documents et fermera toutes les sessions. Une sauvegarde de sécurité sera créée. Tapez RESTAURER pour continuer.",
                      ) !== "RESTAURER"
                    )
                      return;
                    setBusy(true);
                    try {
                      await api("/admin/restore", "POST", {
                        id: b.id,
                        confirmation: "RESTAURER",
                      });
                      logout();
                    } catch (e) {
                      onError(e);
                      setBusy(false);
                    }
                  }}
                >
                  Restaurer
                </button>
              </div>
            ))}
          </div>
        ) : (
          <Empty>Aucune sauvegarde disponible.</Empty>
        )}
      </section>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
