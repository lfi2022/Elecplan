import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  getDocument,
  GlobalWorkerOptions,
  type PDFDocumentProxy,
  type RenderTask,
} from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { api, bytes, labels, type Location, type Client } from "./api";
import { electricalPlanStageForFolder } from "../../shared/electricalPlans";
import { ElectricalPlanStageBadge } from "./ElectricalPlanStage";
import "./reader.css";

GlobalWorkerOptions.workerSrc = workerUrl;
type Version = {
  id: string;
  revision: string;
  mime: string;
  originalName: string;
  size: number;
};
type Plan = {
  id: string;
  name: string;
  reference: string;
  description: string;
  locationId: string;
  currentVersionId: string | null;
  versions: Version[];
  status: string;
  category: string;
  installationType: string;
};
type Folder = {
  items: Plan[];
  total: number;
  page: number;
  loading: boolean;
  error?: string;
};
const supported = (mime: string) =>
  ["application/pdf", "image/png", "image/jpeg"].includes(mime);

export function DocumentReader({
  locations,
  clients,
  initialDocumentId,
  initialVersionId,
  canDownload,
  close,
}: {
  locations: Location[];
  clients: Client[];
  initialDocumentId?: string;
  initialVersionId?: string;
  canDownload: boolean;
  close: () => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(locations.filter((l) => !l.parentId).map((l) => l.id)),
  );
  const [folders, setFolders] = useState<Record<string, Folder>>({});
  const cache = useRef<Record<string, Folder>>({}),
    alive = useRef(true),
    selection = useRef(0),
    dialog = useRef<HTMLDivElement>(null);
  const [doc, setDoc] = useState<Plan | null>(null),
    [versionId, setVersionId] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [side, setSide] = useState(
      localStorage.getItem("reader-side") === "right" ? "right" : "left",
    ),
    [sidebar, setSidebar] = useState(
      () => window.innerWidth > 700 || !initialDocumentId,
    ),
    [query, setQuery] = useState("");
  async function loadFolder(id: string, more = false) {
    const old = cache.current[id];
    if (old?.loading || (!more && old && !old.error)) return;
    const page = more ? (old?.page || 0) + 1 : 1;
    const update = (value: Folder) => {
      cache.current[id] = value;
      if (alive.current) setFolders({ ...cache.current });
    };
    update({
      ...old,
      items: old?.items || [],
      total: old?.total || 0,
      page: old?.page || 0,
      loading: true,
      error: undefined,
    });
    try {
      const result = await api<{ items: Plan[]; total: number; page: number }>(
        `/documents?locationId=${id}&recursive=0&page=${page}`,
      );
      update({
        ...result,
        items: more ? [...(old?.items || []), ...result.items] : result.items,
        loading: false,
      });
    } catch (e) {
      update({
        ...cache.current[id],
        loading: false,
        error: (e as Error).message,
      });
    }
  }
  async function selectDocument(id: string, requestedVersion?: string) {
    const request = ++selection.current;
    setBusy(true);
    setError("");
    setDoc(null);
    try {
      const result = await api<Plan>(`/documents/${id}`);
      if (!alive.current || request !== selection.current) return;
      setDoc(result);
      if (window.innerWidth <= 700) setSidebar(false);
      setVersionId(
        result.versions.some((v) => v.id === requestedVersion)
          ? requestedVersion!
          : result.currentVersionId || result.versions[0]?.id || "",
      );
      const ancestors: string[] = [];
      let folder = locations.find((l) => l.id === result.locationId);
      while (folder) {
        ancestors.push(folder.id);
        folder = locations.find((l) => l.id === folder!.parentId);
      }
      setExpanded((previous) => new Set([...previous, ...ancestors]));
      ancestors.forEach((id) => void loadFolder(id));
    } catch (e) {
      if (alive.current && request === selection.current)
        setError((e as Error).message);
    } finally {
      if (alive.current && request === selection.current) setBusy(false);
    }
  }
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    alive.current = true;
    dialog.current?.focus();
    const keyboard = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      }
      if (e.key === "Tab") {
        const elements = Array.from(
          dialog.current?.querySelectorAll<HTMLElement>(
            'button:not([disabled]),select,input,a[href],[tabindex="0"]',
          ) || [],
        ).filter((el) => el.getClientRects().length);
        const first = elements[0],
          last = elements.at(-1);
        if (
          e.shiftKey &&
          (document.activeElement === first ||
            document.activeElement === dialog.current)
        ) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", keyboard);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    locations.filter((l) => !l.parentId).forEach((l) => void loadFolder(l.id));
    if (initialDocumentId)
      void selectDocument(initialDocumentId, initialVersionId);
    return () => {
      alive.current = false;
      selection.current++;
      document.removeEventListener("keydown", keyboard);
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, []);
  function toggle(id: string) {
    setExpanded((old) => {
      const next = new Set(old);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    void loadFolder(id);
  }
  function branch(location: Location, depth = 0): ReactNode {
    const folder = folders[location.id],
      opened = expanded.has(location.id),
      children = locations.filter((l) => l.parentId === location.id);
    const visibleFiles = (folder?.items || []).filter(
      (item) =>
        !query ||
        `${item.name} ${item.reference}`
          .toLocaleLowerCase("fr")
          .includes(query.toLocaleLowerCase("fr")),
    );
    return (
      <li key={location.id} className="reader-branch">
        <button
          className={`reader-folder ${doc?.locationId === location.id ? "selected" : ""}`}
          aria-expanded={opened}
          onClick={() => toggle(location.id)}
          style={{ paddingLeft: 12 + depth * 14 }}
        >
          <span aria-hidden="true">{opened ? "▾" : "▸"} ▦</span>
          <span>
            {location.name}
            <small>{labels[location.kind]}</small>
            {["SITE", "BUILDING"].includes(location.kind) && (
              <ElectricalPlanStageBadge
                stage={
                  electricalPlanStageForFolder(locations, clients, location.id)
                    .stage
                }
              />
            )}
          </span>
        </button>
        {opened && (
          <ul>
            {children.map((child) => branch(child, depth + 1))}
            {visibleFiles.map((item) => (
              <li key={item.id}>
                <button
                  className={`reader-file ${doc?.id === item.id ? "selected" : ""}`}
                  style={{ paddingLeft: 28 + depth * 14 }}
                  onClick={() => void selectDocument(item.id)}
                  aria-current={doc?.id === item.id ? "true" : undefined}
                >
                  <span aria-hidden="true">▤</span>
                  <span>
                    {item.name}
                    <small>{item.reference}</small>
                  </span>
                </button>
              </li>
            ))}
            {folder?.loading && (
              <li className="reader-folder-message">Chargement…</li>
            )}
            {folder?.error && (
              <li className="reader-folder-message" role="alert">
                {folder.error}
                <button onClick={() => void loadFolder(location.id)}>
                  Réessayer
                </button>
              </li>
            )}
            {folder &&
              !folder.loading &&
              !folder.error &&
              !visibleFiles.length &&
              !children.length && (
                <li className="reader-folder-message">
                  {query ? "Aucun résultat dans ce dossier." : "Dossier vide"}
                </li>
              )}
            {folder &&
              folder.items.length < folder.total &&
              !folder.loading && (
                <li>
                  <button
                    className="reader-more"
                    onClick={() => void loadFolder(location.id, true)}
                  >
                    Afficher plus ({folder.total - folder.items.length})
                  </button>
                </li>
              )}
          </ul>
        )}
      </li>
    );
  }
  const version = doc?.versions.find((v) => v.id === versionId);
  return (
    <div
      className={`document-reader reader-side-${side} ${sidebar ? "" : "reader-sidebar-hidden"}`}
      role="dialog"
      aria-modal="true"
      aria-label="Lecteur de documents"
      tabIndex={-1}
      ref={dialog}
    >
      <div className="reader-top">
        <div>
          <span className="reader-brand">ϟ</span>
          <strong>Lecteur de plans</strong>
          <small>
            {doc
              ? `${doc.reference} · ${doc.name}`
              : "Parcourez votre patrimoine et sélectionnez un fichier"}
          </small>
        </div>
        <div className="reader-actions">
          <button
            className="secondary"
            aria-pressed={sidebar}
            onClick={() => setSidebar((v) => !v)}
          >
            {sidebar ? "Masquer" : "Afficher"} les dossiers
          </button>
          <button
            className="secondary"
            onClick={() => {
              const next = side === "left" ? "right" : "left";
              setSide(next);
              localStorage.setItem("reader-side", next);
            }}
          >
            Dossiers à {side === "left" ? "droite" : "gauche"}
          </button>
          <button
            className="secondary"
            aria-label="Fermer le lecteur"
            onClick={close}
          >
            × Fermer
          </button>
        </div>
      </div>
      <div className="reader-layout">
        <section
          className="reader-explorer"
          aria-label="Dossiers du patrimoine"
        >
          <div className="reader-explorer-head">
            <h2>Patrimoine & documents</h2>
            <input
              aria-label="Filtrer les fichiers des dossiers ouverts"
              placeholder="Filtrer les fichiers chargés…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <p>Dépliez un dossier pour afficher ses fichiers.</p>
          </div>
          <ul className="reader-tree">
            {locations.filter((l) => !l.parentId).map((l) => branch(l))}
          </ul>
          {!locations.length && (
            <p className="reader-folder-message">Aucun site accessible.</p>
          )}
        </section>
        <section className="reader-center" aria-label="Document ouvert">
          {error ? (
            <div role="alert" className="reader-placeholder">
              {error}
            </div>
          ) : busy ? (
            <div role="status" className="reader-placeholder">
              Ouverture du document…
            </div>
          ) : doc && version ? (
            <>
              <div className="reader-document-bar">
                <div>
                  <h2>{doc.name}</h2>
                  <small>
                    {version.originalName} · {bytes(version.size)}
                  </small>
                </div>
                <label>
                  Révision{" "}
                  <select
                    aria-label="Révision affichée"
                    value={versionId}
                    onChange={(e) => setVersionId(e.target.value)}
                  >
                    {doc.versions.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.revision}
                        {v.id === doc.currentVersionId ? " · En vigueur" : ""}
                      </option>
                    ))}
                  </select>
                </label>
                {canDownload && (
                  <a
                    className="button secondary"
                    href={`/api/documents/${doc.id}/versions/${version.id}/file`}
                  >
                    Télécharger
                  </a>
                )}
              </div>
              {supported(version.mime) ? (
                <FileViewer
                  key={`${doc.id}-${version.id}`}
                  documentId={doc.id}
                  version={version}
                  name={doc.name}
                />
              ) : (
                <div className="reader-placeholder">
                  Aperçu indisponible pour ce format CAO.{" "}
                  {canDownload
                    ? "Utilisez Télécharger pour ouvrir le fichier dans votre logiciel."
                    : "Contactez un utilisateur autorisé pour obtenir le fichier."}
                </div>
              )}
              <div className="reader-footer">
                {locations.find((l) => l.id === doc.locationId)?.name}{" "}
                {doc.installationType === "Électricité" && (
                  <span>
                    Plans électriques :{" "}
                    <ElectricalPlanStageBadge
                      stage={
                        electricalPlanStageForFolder(
                          locations,
                          clients,
                          doc.locationId,
                        ).stage
                      }
                    />
                  </span>
                )}
                <span>
                  {doc.status} · {doc.category}
                </span>
              </div>
            </>
          ) : (
            <div className="reader-placeholder">
              <span>▤</span>
              <h2>
                {doc
                  ? "Aucun fichier importé"
                  : "Votre documentation, en lecture directe"}
              </h2>
              <p>
                {doc
                  ? "Cette fiche ne contient aucune révision."
                  : "Sélectionnez un document dans les dossiers sur le côté."}
              </p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function FileViewer({
  documentId,
  version,
  name,
}: {
  documentId: string;
  version: Version;
  name: string;
}) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null),
    [page, setPage] = useState(1),
    [zoom, setZoom] = useState<number | null>(null),
    [rotation, setRotation] = useState(0),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [width, setWidth] = useState(800),
    [rendered, setRendered] = useState(false);
  const [imageSize, setImageSize] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null),
    surface = useRef<HTMLDivElement>(null);
  const url = `/api/documents/${documentId}/versions/${version.id}/file?preview=1`;
  useEffect(() => {
    const observer = new ResizeObserver((entries) =>
      setWidth(Math.max(100, entries[0].contentRect.width - 48)),
    );
    if (surface.current) observer.observe(surface.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (version.mime !== "application/pdf") return;
    let active = true;
    const task = getDocument({
      url,
      withCredentials: true,
      cMapUrl: "/pdfjs/cmaps/",
      cMapPacked: true,
      standardFontDataUrl: "/pdfjs/standard_fonts/",
      wasmUrl: "/pdfjs/wasm/",
      iccUrl: "/pdfjs/iccs/",
      disableAutoFetch: true,
      disableRange: true,
      disableStream: true,
    });
    task.promise
      .then((document) => {
        if (active) {
          setPdf(document);
          setLoading(false);
        }
      })
      .catch(() => {
        if (active) {
          setError(
            "Impossible de lire ce PDF. Vérifiez votre connexion et les droits d’accès.",
          );
          setLoading(false);
        }
      });
    return () => {
      active = false;
      void task.destroy();
    };
  }, [url, version.mime]);
  useEffect(() => {
    if (!pdf) return;
    let active = true,
      render: RenderTask | undefined;
    setRendered(false);
    setLoading(true);
    setError("");
    void pdf
      .getPage(page)
      .then(async (pdfPage) => {
        if (!active || !canvas.current) return;
        const base = pdfPage.getViewport({
          scale: 1,
          rotation: (pdfPage.rotate + rotation) % 360,
        });
        const scale = zoom ?? Math.min(width / base.width, 2),
          viewport = pdfPage.getViewport({
            scale,
            rotation: (pdfPage.rotate + rotation) % 360,
          });
        // Keep large engineering plans within a bounded canvas allocation.
        const density = Math.min(
          window.devicePixelRatio || 1,
          2,
          Math.sqrt(16_000_000 / (viewport.width * viewport.height)),
        );
        const element = canvas.current;
        element.width = Math.max(1, Math.floor(viewport.width * density));
        element.height = Math.max(1, Math.floor(viewport.height * density));
        element.style.width = `${viewport.width}px`;
        element.style.height = `${viewport.height}px`;
        render = pdfPage.render({
          canvas: element,
          canvasContext: element.getContext("2d")!,
          viewport,
          transform: [density, 0, 0, density, 0, 0],
        });
        await render.promise;
        if (active) {
          setRendered(true);
          setLoading(false);
        }
      })
      .catch((e) => {
        if (active && e.name !== "RenderingCancelledException") {
          setError("Le rendu de cette page a échoué.");
          setLoading(false);
        }
      });
    return () => {
      active = false;
      render?.cancel();
    };
  }, [pdf, page, zoom, rotation, width]);
  const isPdf = version.mime === "application/pdf";
  const imageScale = imageSize
    ? (zoom ??
      Math.min(
        1,
        width / (rotation % 180 ? imageSize.height : imageSize.width),
      ))
    : 1;
  const imageWidth = imageSize ? imageSize.width * imageScale : undefined,
    imageHeight = imageSize ? imageSize.height * imageScale : undefined;
  return (
    <>
      <div className="reader-tools" aria-label="Commandes du lecteur">
        {isPdf && (
          <>
            <button
              className="secondary"
              aria-label="Page précédente"
              disabled={!pdf || page <= 1}
              onClick={() => setPage((v) => v - 1)}
            >
              ←
            </button>
            <label>
              Page{" "}
              <input
                aria-label="Page PDF"
                type="number"
                min={1}
                max={pdf?.numPages || 1}
                value={page}
                onChange={(e) => {
                  const value = Number(e.target.value);
                  if (
                    Number.isInteger(value) &&
                    value >= 1 &&
                    value <= (pdf?.numPages || 1)
                  )
                    setPage(value);
                }}
              />{" "}
              / {pdf?.numPages || "…"}
            </label>
            <button
              className="secondary"
              aria-label="Page suivante"
              disabled={!pdf || page >= pdf.numPages}
              onClick={() => setPage((v) => v + 1)}
            >
              →
            </button>
            <span className="reader-tool-divider" />
          </>
        )}
        <button
          className="secondary"
          aria-label="Réduire le zoom"
          onClick={() => setZoom((v) => Math.max(0.25, (v ?? 1) - 0.25))}
        >
          −
        </button>
        <select
          aria-label="Zoom du document"
          value={zoom === null ? "fit" : String(zoom)}
          onChange={(e) =>
            setZoom(e.target.value === "fit" ? null : Number(e.target.value))
          }
        >
          <option value="fit">Ajuster à la largeur</option>
          {Array.from(
            new Set([
              0.25,
              0.5,
              0.75,
              1,
              1.25,
              1.5,
              1.75,
              2,
              2.25,
              2.5,
              2.75,
              3,
              3.25,
              3.5,
              3.75,
              4,
              ...(zoom === null ? [] : [zoom]),
            ]),
          )
            .sort((a, b) => a - b)
            .map((n) => (
              <option key={n} value={n}>
                {Math.round(n * 100)} %
              </option>
            ))}
        </select>
        <button
          className="secondary"
          aria-label="Agrandir le zoom"
          onClick={() => setZoom((v) => Math.min(4, (v ?? 1) + 0.25))}
        >
          +
        </button>
        <button
          className="secondary"
          aria-label="Pivoter le document"
          onClick={() => setRotation((v) => (v + 90) % 360)}
        >
          ↻ Rotation
        </button>
      </div>
      <div
        className="reader-surface"
        ref={surface}
        tabIndex={0}
        aria-label="Zone de lecture défilante"
      >
        {loading && (
          <p className="reader-loading" role="status">
            Chargement du {isPdf ? "PDF" : "fichier"}…
          </p>
        )}
        {error && (
          <p className="reader-render-error" role="alert">
            {error}
          </p>
        )}
        {isPdf ? (
          <canvas
            ref={canvas}
            role="img"
            aria-label={`${name} — page ${page}`}
            data-rendered={rendered}
            className={
              error ? "reader-canvas reader-canvas-error" : "reader-canvas"
            }
          />
        ) : (
          <div
            className="reader-image-wrapper"
            style={
              imageSize
                ? {
                    width: rotation % 180 ? imageHeight : imageWidth,
                    height: rotation % 180 ? imageWidth : imageHeight,
                  }
                : undefined
            }
          >
            <img
              alt={name}
              src={url}
              style={{
                width: imageWidth,
                height: imageHeight,
                position: imageSize ? "absolute" : undefined,
                left: imageSize ? "50%" : undefined,
                top: imageSize ? "50%" : undefined,
                transform: imageSize
                  ? `translate(-50%, -50%) rotate(${rotation}deg)`
                  : `rotate(${rotation}deg)`,
              }}
              onLoad={(event) => {
                setImageSize({
                  width: event.currentTarget.naturalWidth,
                  height: event.currentTarget.naturalHeight,
                });
                setLoading(false);
              }}
              onError={() => {
                setLoading(false);
                setError("Impossible de charger cette image.");
              }}
            />
          </div>
        )}
      </div>
    </>
  );
}
