import { useEffect, useState } from "react";
import { api, type Client, type Location } from "./api";
import { ElectricalPlanStageBadge } from "./ElectricalPlanStage";

export function Clients({
  locations,
  notify,
  onError,
}: {
  locations: Location[];
  notify: (message: string) => void;
  onError: (e: unknown) => void;
}) {
  const [clients, setClients] = useState<Client[]>([]),
    [editing, setEditing] = useState<Partial<Client> | null>(null),
    [query, setQuery] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    api<Client[]>("/clients").then(setClients).catch(onError);
  }, []);
  const visible = clients.filter((c) =>
    `${c.name} ${c.code} ${c.prefix}`
      .toLocaleLowerCase("fr")
      .includes(query.toLocaleLowerCase("fr")),
  );
  return (
    <>
      <div className="toolbar">
        <span>{clients.length} clients</span>
        <button
          onClick={() => {
            setEditing({ active: true });
            setError("");
          }}
        >
          + Nouveau client
        </button>
      </div>
      <section className="card">
        <label className="field">
          <span>Rechercher un client</span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Nom, code ou préfixe…"
          />
        </label>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>CLIENT</th>
                <th>PRÉFIXE DOCUMENTAIRE</th>
                <th>PATRIMOINE / DOCUMENTS</th>
                <th>PLANS ÉLECTRIQUES</th>
                <th>STATUT</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {visible.map((client) => (
                <tr key={client.id}>
                  <td>
                    <strong>{client.name}</strong>
                    <small>
                      {client.code}
                      {client.email ? ` · ${client.email}` : ""}
                    </small>
                  </td>
                  <td>
                    <code>{client.prefix}-00001</code>
                    <small>
                      Prochaine séquence :{" "}
                      {String(client.nextNumber || 1).padStart(5, "0")}
                    </small>
                  </td>
                  <td>
                    {client._count?.sites || 0} rattachements ·{" "}
                    {client._count?.documents || 0} documents
                    <small>
                      {locations
                        .filter((l) => l.clientId === client.id)
                        .map((l) => l.name)
                        .join(", ") || "Rattachez un site dans Patrimoine"}
                    </small>
                  </td>
                  <td>
                    <ElectricalPlanStageBadge
                      stage={client.electricalPlanStage}
                    />
                  </td>
                  <td>
                    <span
                      className={`status ${client.active ? "green" : "gray"}`}
                    >
                      {client.active ? "Actif" : "Désactivé"}
                    </span>
                  </td>
                  <td>
                    <button
                      className="text-button"
                      onClick={() => {
                        setEditing(client);
                        setError("");
                      }}
                    >
                      Modifier
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!visible.length && (
          <p className="empty">
            {clients.length
              ? "Aucun client correspondant."
              : "Créez un client, puis rattachez-lui un site dans Patrimoine."}
          </p>
        )}
      </section>
      {editing && (
        <div
          className="veil"
          onClick={() => {
            if (!busy) setEditing(null);
          }}
        >
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label={editing.id ? "Modifier le client" : "Créer un client"}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="section-head">
              <h2>{editing.id ? "Modifier le client" : "Créer un client"}</h2>
              <button
                className="icon"
                aria-label="Fermer"
                disabled={busy}
                onClick={() => setEditing(null)}
              >
                ×
              </button>
            </div>
            {error && (
              <p role="alert" className="alert error">
                {error}
              </p>
            )}
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const form = new FormData(e.currentTarget),
                  data = {
                    ...Object.fromEntries(form),
                    active: form.get("active") === "on",
                    electricalPlanStage:
                      form.get("electricalPlanStage") || null,
                  };
                setBusy(true);
                try {
                  await api(
                    editing.id ? `/clients/${editing.id}` : "/clients",
                    editing.id ? "PUT" : "POST",
                    data,
                  );
                  setEditing(null);
                  notify(
                    "Client enregistré. Les prochains documents utilisent les nouveaux paramètres. Les anciennes références sont conservées.",
                  );
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <label className="field">
                <span>Nom du client</span>
                <input
                  name="name"
                  defaultValue={editing.name}
                  required
                  maxLength={200}
                  autoFocus
                />
              </label>
              <div className="form-grid">
                <label className="field">
                  <span>Plans électriques : provisoire ou définitif</span>
                  <select
                    name="electricalPlanStage"
                    defaultValue={editing.electricalPlanStage || ""}
                  >
                    <option value="">Non renseigné</option>
                    <option value="PROVISIONAL">Provisoire</option>
                    <option value="FINAL">Définitif</option>
                  </select>
                  <small>
                    Valeur du dossier client, utilisée par les bâtiments sans
                    indication propre.
                  </small>
                </label>
                <label className="field">
                  <span>Code client</span>
                  <input
                    name="code"
                    defaultValue={editing.code}
                    placeholder="ACME"
                    required
                    minLength={2}
                    maxLength={20}
                    pattern="[A-Za-z0-9]+(-[A-Za-z0-9]+)*"
                  />
                </label>
                <label className="field">
                  <span>Préfixe documentaire</span>
                  <input
                    name="prefix"
                    defaultValue={editing.prefix}
                    placeholder="ACME-ELEC"
                    required
                    minLength={2}
                    maxLength={40}
                    pattern="[A-Za-z0-9]+(-[A-Za-z0-9]+)*"
                  />
                  <small>
                    Exemple : ACME-ELEC-00001. Le préfixe peut être modifié :
                    les anciennes références sont conservées et la numérotation
                    continue.
                  </small>
                </label>
                <label className="field">
                  <span>E-mail</span>
                  <input
                    name="email"
                    type="email"
                    defaultValue={editing.email || ""}
                    maxLength={254}
                  />
                </label>
                <label className="field">
                  <span>Téléphone</span>
                  <input
                    name="phone"
                    defaultValue={editing.phone || ""}
                    maxLength={50}
                  />
                </label>
              </div>
              <label className="field">
                <span>Adresse</span>
                <textarea
                  name="address"
                  defaultValue={editing.address || ""}
                  maxLength={1000}
                />
              </label>
              <label className="field">
                <span>Notes client</span>
                <textarea
                  name="description"
                  defaultValue={editing.description || ""}
                  maxLength={5000}
                />
              </label>
              <label className="check">
                <input
                  name="active"
                  type="checkbox"
                  defaultChecked={editing.active !== false}
                />
                Client actif
              </label>
              <p className="muted">
                La désactivation conserve les sites, documents et références
                existants, et bloque la création de nouveaux documents sur ses
                sites.
              </p>
              <button disabled={busy}>
                {busy ? "Enregistrement…" : "Enregistrer le client"}
              </button>
            </form>
          </section>
        </div>
      )}
    </>
  );
}
