import "./config.js";
import Fastify, { type FastifyRequest } from "fastify";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import serveStatic from "@fastify/static";
import { PrismaClient, type User, type Prisma } from "@prisma/client";
import { z, ZodError } from "zod";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import os from "node:os";
import QRCode from "qrcode";
import { config } from "./config.js";
import {
  can,
  digest,
  hashPassword,
  permissions,
  sameSecret,
  token,
  verifyPassword,
} from "./security.js";
import { storeFile, removeFile } from "./storage.js";
import { verifyLicense } from "./license.js";
import { createBackup, listBackups, restoreBackup } from "./backup.js";
import {
  registerClients,
  assertClientForSite,
  allocateReference,
} from "./clients.js";
import { editLocation } from "./hierarchy.js";
import {
  effectiveClient,
  allowedParents,
  descendantIds,
} from "../shared/hierarchy.js";
z.config(z.locales.fr());

declare module "fastify" {
  interface FastifyRequest {
    user: User;
    siteIds: string[];
    release?: () => void;
  }
}
function fail(statusCode: number, message: string): never {
  throw Object.assign(new Error(message), { statusCode });
}
const idSchema = z.string().uuid();
const text = z.string().trim().min(1).max(200);
const passwordSchema = z.string().min(12).max(128);
const roles = z.enum(["ADMIN", "EDITOR", "READER"]);
const userSchema = z
  .object({
    name: text,
    email: z
      .string()
      .email()
      .max(254)
      .transform((s) => s.toLowerCase()),
    password: passwordSchema,
    role: roles,
    permissions: z
      .array(z.enum(permissions))
      .max(permissions.length)
      .default([]),
    siteIds: z.array(idSchema).max(1000).default([]),
  })
  .strict();
const kinds = [
  "SITE",
  "BUILDING",
  "FLOOR",
  "ZONE",
  "ROOM",
  "PANEL",
  "EQUIPMENT",
] as const;
const locationSchema = z
  .object({
    name: text,
    kind: z.enum(kinds),
    reference: z.string().max(100).default(""),
    description: z.string().max(5000).default(""),
    parentId: idSchema.nullable().default(null),
    clientId: idSchema.nullable().default(null),
    inheritClient: z.boolean().default(true),
  })
  .strict();
const documentSchema = z
  .object({
    name: text,
    reference: z.string().trim().max(200).default(""),
    description: z.string().max(5000).default(""),
    locationId: idSchema,
    clientId: idSchema.nullable().optional(),
    useLocationClient: z.boolean().optional(),
    regenerateReference: z.boolean().optional(),
    category: text.default("Plan électrique"),
    tags: z.array(z.string().trim().min(1).max(50)).max(30).default([]),
    buildingType: z.string().max(100).default(""),
    installationType: z
      .enum([
        "Électricité",
        "HVAC",
        "Plomberie",
        "Incendie",
        "Réseaux informatiques",
      ])
      .default("Électricité"),
    status: z
      .enum(["Brouillon", "À valider", "En vigueur", "Archivé"])
      .default("Brouillon"),
    planDate: z.union([z.iso.date(), z.literal("")]).default(""),
    equipmentIds: z.array(idSchema).max(100).default([]),
  })
  .strict();
const publicUser = (u: User & { sites?: { siteId: string }[] }) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  role: u.role,
  active: u.active,
  permissions: JSON.parse(u.permissions),
  siteIds: u.sites?.map((s) => s.siteId),
});

export async function buildApp(
  options: { logger?: boolean; db?: PrismaClient } = {},
) {
  await mkdir(config.filesDir, { recursive: true, mode: 0o700 });
  await mkdir(config.backupsDir, { recursive: true, mode: 0o700 });
  const db = options.db || new PrismaClient();
  const app = Fastify({
    logger: options.logger ?? true,
    bodyLimit: 1024 * 1024,
    trustProxy: false,
  });
  app.decorate("db", db);
  await app.register(cookie);
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'wasm-unsafe-eval'"],
        workerSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:"],
        frameSrc: ["'self'"],
        objectSrc: ["'none'"],
        upgradeInsecureRequests: null,
      },
    },
  });
  await app.register(rateLimit, {
    max: 300,
    timeWindow: "1 minute",
    errorResponseBuilder: () => ({
      statusCode: 429,
      error: "Trop de tentatives. Réessayez ultérieurement.",
    }),
  });
  await app.register(multipart, {
    limits: { fileSize: config.maxFile, files: 1, fields: 5 },
  });
  let queue: Promise<void> = Promise.resolve();
  // A single admission queue makes snapshots/restores consistent with all API operations.
  app.addHook("preHandler", async (req) => {
    if (!req.url.startsWith("/api")) return;
    // Static-file fallback can invoke not-found hooks again for the same request.
    if (req.release) return;
    const previous = queue;
    queue = new Promise<void>((resolve) => {
      req.release = resolve;
    });
    await previous;
  });
  app.addHook("onSend", async (req) => {
    req.release?.();
  });
  app.addHook("onError", async (req) => {
    req.release?.();
  });
  app.addHook("preHandler", async (req, reply) => {
    if (!req.url.startsWith("/api")) return;
    reply.header("Cache-Control", "no-store");
    if (["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
      if (
        req.headers.origin &&
        req.headers.origin !== new URL(config.publicUrl).origin
      )
        fail(403, "Origine de requête refusée.");
      if (req.headers["sec-fetch-site"] === "cross-site")
        fail(403, "Requête intersite refusée.");
    }
    const url = req.url.split("?")[0];
    if (["/api/health", "/api/setup", "/api/auth/login"].includes(url)) return;
    const raw = req.cookies.electroplan;
    if (!raw) fail(401, "Authentification requise.");
    const session = await db.session.findUnique({
      where: { id: digest(raw) },
      include: { user: { include: { sites: true } } },
    });
    if (
      !session ||
      session.expiresAt.getTime() <= Date.now() ||
      !session.user.active
    )
      fail(401, "Session expirée.");
    req.user = session.user;
    req.siteIds = session.user.sites.map((s) => s.siteId);
    if (
      ["POST", "PUT", "PATCH", "DELETE"].includes(req.method) &&
      !sameSecret(String(req.headers["x-csrf-token"] || ""), session.csrf)
    )
      fail(403, "Jeton CSRF invalide.");
  });
  app.setErrorHandler((error, req, reply) => {
    if (error instanceof ZodError)
      return reply.code(400).send({
        error: "Données invalides.",
        details: error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
      });
    if ((error as { code?: string }).code === "P2002")
      return reply
        .code(409)
        .send({ error: "Cette référence, révision ou adresse existe déjà." });
    if ((error as { code?: string }).code === "P2003")
      return reply.code(409).send({
        error: "Suppression impossible : cet élément est encore utilisé.",
      });
    const err = error as { statusCode?: number; message: string };
    const code = err.statusCode || 500;
    if (code >= 500) req.log.error(error);
    return reply.code(code).send({
      error:
        code < 500
          ? (
              {
                413: "Fichier ou requête trop volumineux.",
                415: "Type de contenu non accepté.",
              } as Record<number, string>
            )[code] || err.message
          : "Erreur interne. Consultez le journal du serveur.",
    });
  });
  const requirePermission = (r: FastifyRequest, p: string) => {
    if (!can(r.user, p)) fail(403, "Permission insuffisante.");
  };
  const admin = (r: FastifyRequest) => {
    if (r.user.role !== "ADMIN") fail(403, "Administration réservée.");
  };
  const siteFilter = (r: FastifyRequest) =>
    r.user.role === "ADMIN" ? {} : { siteId: { in: r.siteIds } };
  const assertSite = (r: FastifyRequest, siteId: string) => {
    if (r.user.role !== "ADMIN" && !r.siteIds.includes(siteId))
      fail(404, "Élément introuvable.");
  };
  const audit = (
    r: FastifyRequest,
    action: string,
    target: string,
    siteId?: string,
  ) =>
    db.audit.create({
      data: {
        userId: r.user?.id,
        actor: r.user?.email || "anonyme",
        action,
        target,
        siteId,
        ip: r.ip,
      },
    });
  const getLocation = async (r: FastifyRequest, id: string) => {
    const location = await db.location.findUnique({
      where: { id: idSchema.parse(id) },
    });
    if (!location) fail(404, "Localisation introuvable.");
    assertSite(r, location.siteId);
    return location;
  };
  const getDocument = async (r: FastifyRequest, id: string) => {
    const document = await db.document.findUnique({
      where: { id: idSchema.parse(id) },
      include: {
        location: true,
        client: { select: { id: true, name: true, code: true, prefix: true } },
        equipment: { include: { equipment: true } },
        versions: {
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            revision: true,
            originalName: true,
            mime: true,
            size: true,
            sha256: true,
            author: true,
            createdAt: true,
          },
        },
      },
    });
    if (!document) fail(404, "Document introuvable.");
    assertSite(r, document.siteId);
    return {
      ...document,
      tags: JSON.parse(document.tags),
      referenceHistory: JSON.parse(document.referenceHistory),
    };
  };
  async function installationId() {
    return (
      await db.setting.upsert({
        where: { key: "installationId" },
        create: { key: "installationId", value: randomUUID() },
        update: {},
      })
    ).value;
  }
  async function licenseState() {
    const saved = await db.setting.findUnique({ where: { key: "license" } });
    if (saved)
      try {
        return {
          ...(await verifyLicense(
            JSON.parse(saved.value),
            await installationId(),
          )),
          valid: true,
        };
      } catch (e) {
        return {
          edition: "Standard",
          valid: false,
          error: (e as Error).message,
        };
      }
    return { edition: "Standard", valid: true, customer: null };
  }
  registerClients(app, db, { admin, requirePermission, audit });
  app.get("/api/health", async () => ({ status: "ok" }));
  app.get("/api/setup", async () => ({
    required: (await db.user.count()) === 0,
  }));
  app.post(
    "/api/setup",
    { config: { rateLimit: { max: 5, timeWindow: "15 minutes" } } },
    async (req, reply) => {
      const input = z
        .object({
          name: text,
          email: z
            .string()
            .email()
            .transform((s) => s.toLowerCase()),
          password: passwordSchema,
          token: z.string(),
        })
        .strict()
        .parse(req.body);
      if (await db.user.count()) fail(409, "Installation déjà configurée.");
      if (
        config.setupToken.length < 24 ||
        !sameSecret(input.token, config.setupToken)
      )
        fail(403, "Jeton de première configuration invalide.");
      await db.user.create({
        data: {
          name: input.name,
          email: input.email,
          passwordHash: await hashPassword(input.password),
          role: "ADMIN",
        },
      });
      await installationId();
      await audit(req, "setup", "Création administrateur");
      return reply.code(201).send({ ok: true });
    },
  );
  app.post(
    "/api/auth/login",
    { config: { rateLimit: { max: 10, timeWindow: "15 minutes" } } },
    async (req, reply) => {
      const input = z
        .object({
          email: z
            .string()
            .email()
            .transform((s) => s.toLowerCase()),
          password: z.string().max(128),
        })
        .parse(req.body);
      const user = await db.user.findUnique({ where: { email: input.email } });
      // Scrypt is also performed for unknown accounts to reduce timing disclosure.
      const valid = await verifyPassword(
        input.password,
        user?.passwordHash ||
          `scrypt:00000000000000000000000000000000:${"00".repeat(64)}`,
      );
      if (!user?.active || !valid) {
        await audit(req, "login.failed", input.email);
        fail(401, "Identifiants incorrects.");
      }
      const raw = token(),
        csrf = token();
      await db.session.deleteMany({ where: { expiresAt: { lt: new Date() } } });
      await db.session.create({
        data: {
          id: digest(raw),
          csrf,
          userId: user.id,
          expiresAt: new Date(Date.now() + 8 * 3600 * 1000),
        },
      });
      reply.setCookie("electroplan", raw, {
        httpOnly: true,
        secure: config.secure,
        sameSite: "strict",
        path: "/",
        maxAge: 8 * 3600,
      });
      req.user = user;
      await audit(req, "login", user.id);
      return { user: publicUser(user), csrf };
    },
  );
  app.get("/api/auth/me", async (req) => ({
    user: publicUser(req.user),
    csrf: (
      await db.session.findUniqueOrThrow({
        where: { id: digest(req.cookies.electroplan!) },
      })
    ).csrf,
    capabilities: permissions.filter((p) => can(req.user, p)),
    license: await licenseState(),
    organization:
      (await db.setting.findUnique({ where: { key: "organization" } }))
        ?.value || "Mon installation",
  }));
  app.post("/api/auth/logout", async (req, reply) => {
    await db.session.delete({
      where: { id: digest(req.cookies.electroplan!) },
    });
    reply.clearCookie("electroplan", { path: "/" });
    return { ok: true };
  });
  app.post("/api/auth/password", async (req) => {
    const input = z
      .object({ current: z.string().max(128), password: passwordSchema })
      .parse(req.body);
    if (!(await verifyPassword(input.current, req.user.passwordHash)))
      fail(400, "Mot de passe actuel incorrect.");
    await db.$transaction([
      db.user.update({
        where: { id: req.user.id },
        data: { passwordHash: await hashPassword(input.password) },
      }),
      db.session.deleteMany({ where: { userId: req.user.id } }),
    ]);
    await audit(req, "password.change", req.user.id);
    return { ok: true };
  });
  app.get("/api/dashboard", async (req) => {
    requirePermission(req, "documents:read");
    const where = siteFilter(req);
    const [documents, locations, recent, activity] = await Promise.all([
      db.document.count({ where }),
      db.location.groupBy({ by: ["kind"], where, _count: true }),
      db.document.findMany({
        where,
        orderBy: { updatedAt: "desc" },
        take: 8,
        include: { location: true },
      }),
      db.audit.findMany({ where, orderBy: { createdAt: "desc" }, take: 10 }),
    ]);
    return { documents, locations, recent, activity };
  });
  app.get("/api/locations", async (req) => {
    requirePermission(req, "documents:read");
    return db.location.findMany({
      where: siteFilter(req),
      orderBy: [{ kind: "asc" }, { name: "asc" }],
    });
  });
  app.post("/api/locations", async (req, reply) => {
    requirePermission(req, "locations:write");
    const input = locationSchema.parse(req.body),
      id = randomUUID();
    let siteId: string = id;
    if (input.kind === "SITE") {
      if (input.parentId) fail(400, "Un site ne peut avoir de parent.");
      admin(req);
    } else {
      if (!input.parentId) fail(400, "Parent requis.");
      const parent = await getLocation(req, input.parentId);
      if (!allowedParents[input.kind].includes(parent.kind))
        fail(400, "Niveau parent incompatible.");
      siteId = parent.siteId;
    }
    if (input.clientId || !input.inheritClient) {
      admin(req);
      await assertClientForSite(db, input.clientId);
    }
    const result = await db.location.create({
      data: {
        ...input,
        inheritClient: input.clientId ? false : input.inheritClient,
        id,
        siteId,
      },
    });
    await audit(req, "location.create", id, siteId);
    return reply.code(201).send(result);
  });
  app.patch("/api/locations/:id", async (req) => {
    requirePermission(req, "locations:write");
    const result = await editLocation(
      db,
      req,
      (req.params as { id: string }).id,
    );
    await audit(req, "location.update", result.id, result.siteId);
    return result;
  });
  app.delete("/api/locations/:id", async (req) => {
    requirePermission(req, "locations:write");
    const old = await getLocation(req, (req.params as { id: string }).id);
    if (old.kind === "SITE") admin(req);
    await db.location.delete({ where: { id: old.id } });
    await audit(req, "location.delete", old.id, old.siteId);
    return { ok: true };
  });
  app.get("/api/locations/:id/qr", async (req, reply) => {
    requirePermission(req, "documents:read");
    const location = await getLocation(req, (req.params as { id: string }).id);
    const png = await QRCode.toBuffer(
      `${config.publicUrl}/?location=${location.id}`,
      { width: 480, margin: 2 },
    );
    return reply.type("image/png").send(png);
  });
  app.get("/api/documents", async (req) => {
    requirePermission(req, "documents:read");
    const q = z
      .object({
        q: z.string().max(200).optional(),
        siteId: idSchema.optional(),
        clientId: idSchema.optional(),
        locationId: idSchema.optional(),
        recursive: z.enum(["0", "1"]).default("1"),
        category: z.string().max(200).optional(),
        status: z.string().max(100).optional(),
        tag: z.string().max(50).optional(),
        installationType: z.string().max(100).optional(),
        buildingType: z.string().max(100).optional(),
        equipmentId: idSchema.optional(),
        dateFrom: z.iso.date().optional(),
        dateTo: z.iso.date().optional(),
        page: z.coerce.number().int().min(1).max(100000).default(1),
      })
      .parse(req.query);
    if (q.siteId) assertSite(req, q.siteId);
    const locationIds = q.locationId
      ? q.recursive === "0"
        ? [(await getLocation(req, q.locationId)).id]
        : [
            ...descendantIds(
              await db.location.findMany({
                where: {
                  siteId: (await getLocation(req, q.locationId)).siteId,
                },
              }),
              q.locationId,
            ),
          ]
      : null;
    const terms = q.q?.match(/[\p{L}\p{N}_]+/gu) || [];
    const ftsQuery = terms.map((term) => `"${term}"*`).join(" AND ");
    const textMatches = ftsQuery
      ? await db.$queryRaw<
          Array<{ documentId: string }>
        >`SELECT DISTINCT "documentId" FROM "VersionSearch" WHERE "VersionSearch" MATCH ${ftsQuery}`
      : [];
    const where = {
      AND: [
        siteFilter(req),
        q.siteId ? { siteId: q.siteId } : {},
        q.clientId ? { clientId: q.clientId } : {},
        locationIds ? { locationId: { in: locationIds } } : {},
        q.category ? { category: q.category } : {},
        q.status ? { status: q.status } : {},
        q.installationType ? { installationType: q.installationType } : {},
        q.buildingType ? { buildingType: q.buildingType } : {},
        q.equipmentId
          ? { equipment: { some: { equipmentId: q.equipmentId } } }
          : {},
        q.tag ? { tags: { contains: JSON.stringify(q.tag) } } : {},
        q.dateFrom || q.dateTo
          ? { planDate: { gte: q.dateFrom, lte: q.dateTo } }
          : {},
        q.q
          ? {
              OR: [
                { name: { contains: q.q } },
                { reference: { contains: q.q } },
                { referenceHistory: { contains: q.q } },
                { description: { contains: q.q } },
                { tags: { contains: q.q } },
                { id: { in: textMatches.map((item) => item.documentId) } },
              ],
            }
          : {},
      ],
    };
    const [items, total] = await Promise.all([
      db.document.findMany({
        where,
        orderBy: { updatedAt: "desc" },
        skip: (q.page - 1) * 30,
        take: 30,
        include: {
          location: true,
          client: {
            select: { id: true, name: true, code: true, prefix: true },
          },
          versions: {
            select: { id: true, revision: true, mime: true, size: true },
          },
        },
      }),
      db.document.count({ where }),
    ]);
    return {
      items: items.map((d) => ({ ...d, tags: JSON.parse(d.tags) })),
      total,
      page: q.page,
    };
  });
  app.get("/api/documents/:id", async (req) => {
    requirePermission(req, "documents:read");
    return getDocument(req, (req.params as { id: string }).id);
  });
  async function validateDocument(
    req: FastifyRequest,
    input: z.infer<typeof documentSchema>,
  ) {
    const location = await getLocation(req, input.locationId);
    for (const id of input.equipmentIds) {
      const item = await getLocation(req, id);
      if (
        item.siteId !== location.siteId ||
        !["EQUIPMENT", "PANEL"].includes(item.kind)
      )
        fail(400, "Équipement incompatible avec le site du document.");
    }
    const {
      equipmentIds,
      tags,
      clientId,
      useLocationClient,
      regenerateReference,
      ...fields
    } = input;
    return {
      ...fields,
      tags: JSON.stringify(tags),
      siteId: location.siteId,
      equipmentIds,
      requestedClientId: clientId,
      useLocationClient,
      regenerateReference,
    };
  }
  async function checkDocumentClient(
    req: FastifyRequest,
    clientId: string | null,
    tx: Prisma.TransactionClient,
  ) {
    if (!clientId) return;
    const client = await tx.client.findFirst({
      where: {
        id: clientId,
        ...(req.user.role === "ADMIN"
          ? {}
          : {
              OR: [
                { sites: { some: { siteId: { in: req.siteIds } } } },
                { documents: { some: { siteId: { in: req.siteIds } } } },
              ],
            }),
      },
      select: { id: true, active: true },
    });
    if (!client) fail(404, "Client introuvable ou inaccessible.");
    if (!client.active) fail(409, "Ce client est désactivé.");
  }
  app.post("/api/documents", async (req, reply) => {
    requirePermission(req, "documents:write");
    const {
      equipmentIds,
      requestedClientId,
      useLocationClient,
      regenerateReference,
      ...data
    } = await validateDocument(req, documentSchema.parse(req.body));
    const result = await db.$transaction(async (tx) => {
      const nodes = await tx.location.findMany({
        where: { siteId: data.siteId },
      });
      const clientId =
        useLocationClient || requestedClientId === undefined
          ? effectiveClient(nodes, data.locationId).clientId
          : requestedClientId;
      await checkDocumentClient(req, clientId, tx);
      if (!clientId && !data.reference)
        fail(400, "Une référence libre est requise sans client.");
      if (
        !clientId &&
        ((await tx.document.findFirst({
          where: { reference: data.reference },
          select: { id: true },
        })) ||
          (await tx.referenceReservation.findUnique({
            where: { reference: data.reference },
          })))
      )
        fail(
          409,
          "Cette référence documentaire existe déjà ou a déjà été attribuée.",
        );
      const generated = clientId ? await allocateReference(tx, clientId) : {};
      if (!clientId)
        await tx.referenceReservation.create({
          data: { reference: data.reference },
        });
      return tx.document.create({
        data: {
          ...data,
          ...generated,
          equipment: {
            create: equipmentIds.map((equipmentId) => ({ equipmentId })),
          },
        },
      });
    });
    await audit(req, "document.create", result.id, result.siteId);
    return reply.code(201).send(result);
  });
  app.put("/api/documents/:id", async (req) => {
    requirePermission(req, "documents:write");
    const old = await getDocument(req, (req.params as { id: string }).id);
    const {
      equipmentIds,
      requestedClientId,
      useLocationClient,
      regenerateReference,
      ...data
    } = await validateDocument(req, documentSchema.parse(req.body));
    if (data.siteId !== old.siteId) admin(req);
    const result = await db.$transaction(async (tx) => {
      const nodes = await tx.location.findMany({
        where: { siteId: data.siteId },
      });
      const clientId = useLocationClient
        ? effectiveClient(nodes, data.locationId).clientId
        : requestedClientId === undefined
          ? old.clientId
          : requestedClientId;
      const clientChanged = clientId !== old.clientId;
      if (clientChanged || regenerateReference)
        await checkDocumentClient(req, clientId, tx);
      let reference = data.reference,
        clientNumber = old.clientNumber;
      const generatedReference =
        !!clientId && (clientChanged || regenerateReference === true);
      if (generatedReference) {
        const generated = await allocateReference(tx, clientId!);
        reference = generated.reference;
        clientNumber = generated.clientNumber;
      } else if (old.clientId && clientId && reference !== old.reference)
        fail(
          400,
          "Pour changer une référence automatique, sélectionnez un autre client.",
        );
      if (!clientId) clientNumber = null;
      if (!reference) fail(400, "La référence ne peut pas être vide.");
      if (
        reference !== old.reference &&
        !generatedReference &&
        ((await tx.document.findFirst({
          where: { reference, id: { not: old.id } },
          select: { id: true },
        })) ||
          (await tx.referenceReservation.findUnique({ where: { reference } })))
      )
        fail(409, "Cette référence existe déjà ou a déjà été attribuée.");
      const history = old.referenceHistory as Array<unknown>;
      const changed = clientChanged || reference !== old.reference;
      if (changed) {
        history.push({
          reference: old.reference,
          clientId: old.clientId,
          clientName: old.client?.name || null,
          changedAt: new Date().toISOString(),
          actor: req.user.email,
        });
        await tx.referenceReservation.upsert({
          where: { reference: old.reference },
          create: { reference: old.reference, clientId: old.clientId },
          update: {},
        });
      }
      await tx.referenceReservation.upsert({
        where: { reference },
        create: { reference, clientId },
        update: {},
      });
      return tx.document.update({
        where: { id: old.id },
        data: {
          ...data,
          reference,
          clientId,
          clientNumber,
          referenceHistory: JSON.stringify(history),
          equipment: {
            deleteMany: {},
            create: equipmentIds.map((equipmentId) => ({ equipmentId })),
          },
        },
      });
    });
    await audit(req, "document.update", old.id, old.siteId);
    return result;
  });
  app.delete("/api/documents/:id", async (req) => {
    requirePermission(req, "documents:delete");
    const old = await getDocument(req, (req.params as { id: string }).id);
    const versions = await db.version.findMany({
      where: { documentId: old.id },
    });
    await db.document.delete({ where: { id: old.id } });
    for (const v of versions) await removeFile(v.storageKey);
    await audit(req, "document.delete", old.id, old.siteId);
    return { ok: true };
  });
  app.post("/api/documents/:id/versions", async (req, reply) => {
    requirePermission(req, "documents:write");
    const doc = await getDocument(req, (req.params as { id: string }).id);
    const revision = text.parse((req.query as { revision?: string }).revision);
    const upload = await req.file();
    if (!upload) fail(400, "Fichier requis.");
    const bytes = await upload.toBuffer();
    if (upload.file.truncated) fail(413, "Fichier trop volumineux.");
    const stored = await storeFile(upload.filename, bytes);
    try {
      const result = await db.$transaction(async (tx) => {
        const version = await tx.version.create({
          data: {
            ...stored,
            documentId: doc.id,
            revision,
            author: req.user.email,
          },
        });
        await tx.document.update({
          where: { id: doc.id },
          data: { currentVersionId: version.id },
        });
        return version;
      });
      await audit(req, "version.upload", `${doc.id}:${revision}`, doc.siteId);
      return reply.code(201).send({ id: result.id, revision: result.revision });
    } catch (error) {
      await removeFile(stored.storageKey);
      throw error;
    }
  });
  app.post("/api/documents/:id/restore", async (req) => {
    requirePermission(req, "documents:write");
    const doc = await getDocument(req, (req.params as { id: string }).id),
      { versionId } = z.object({ versionId: idSchema }).parse(req.body);
    if (!doc.versions.some((v) => v.id === versionId))
      fail(404, "Version introuvable.");
    await db.document.update({
      where: { id: doc.id },
      data: { currentVersionId: versionId },
    });
    await audit(req, "version.restore", `${doc.id}:${versionId}`, doc.siteId);
    return { ok: true };
  });
  app.get("/api/documents/:id/versions/:versionId/file", async (req, reply) => {
    const { id, versionId } = req.params as { id: string; versionId: string };
    const doc = await getDocument(req, id);
    const preview = (req.query as { preview?: string }).preview === "1";
    requirePermission(req, preview ? "documents:read" : "documents:download");
    const version = await db.version.findFirst({
      where: { id: idSchema.parse(versionId), documentId: doc.id },
    });
    if (!version) fail(404, "Version introuvable.");
    if (
      preview &&
      !["application/pdf", "image/png", "image/jpeg"].includes(version.mime)
    )
      fail(400, "Aperçu disponible pour PDF et images.");
    await audit(
      req,
      preview ? "document.preview" : "document.download",
      `${doc.id}:${version.id}`,
      doc.siteId,
    );
    reply
      .header(
        "Content-Disposition",
        `${preview ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(version.originalName)}`,
      )
      .header("X-Content-Type-Options", "nosniff");
    return reply
      .type(version.mime)
      .send(createReadStream(path.join(config.filesDir, version.storageKey)));
  });
  app.get("/api/users", async (req) => {
    admin(req);
    return (
      await db.user.findMany({
        include: { sites: true },
        orderBy: { name: "asc" },
      })
    ).map(publicUser);
  });
  async function validateSites(ids: string[]) {
    if (
      (await db.location.count({
        where: { id: { in: ids }, kind: "SITE" },
      })) !== new Set(ids).size
    )
      fail(400, "Sites invalides.");
  }
  app.post("/api/users", async (req, reply) => {
    admin(req);
    const input = userSchema.parse(req.body);
    await validateSites(input.siteIds);
    const { password, siteIds, permissions, ...fields } = input;
    const user = await db.user.create({
      data: {
        ...fields,
        passwordHash: await hashPassword(password),
        permissions: JSON.stringify(permissions),
        sites: { create: [...new Set(siteIds)].map((siteId) => ({ siteId })) },
      },
    });
    await audit(req, "user.create", user.id);
    return reply.code(201).send(publicUser(user));
  });
  app.put("/api/users/:id", async (req) => {
    admin(req);
    const id = idSchema.parse((req.params as { id: string }).id);
    const input = userSchema
      .omit({ password: true })
      .extend({ password: passwordSchema.optional(), active: z.boolean() })
      .parse(req.body);
    await validateSites(input.siteIds);
    const old = await db.user.findUnique({ where: { id } });
    if (!old) fail(404, "Utilisateur introuvable.");
    if (id === req.user.id && (!input.active || input.role !== "ADMIN"))
      fail(
        400,
        "Vous ne pouvez pas désactiver ou rétrograder votre propre compte.",
      );
    const { password, siteIds, permissions, ...fields } = input;
    const user = await db.$transaction(async (tx) => {
      const u = await tx.user.update({
        where: { id },
        data: {
          ...fields,
          permissions: JSON.stringify(permissions),
          ...(password ? { passwordHash: await hashPassword(password) } : {}),
          sites: {
            deleteMany: {},
            create: [...new Set(siteIds)].map((siteId) => ({ siteId })),
          },
        },
      });
      await tx.session.deleteMany({ where: { userId: id } });
      return u;
    });
    await audit(req, "user.update", id);
    return publicUser(user);
  });
  app.get("/api/audit", async (req) => {
    requirePermission(req, "audit:read");
    const q = z
      .object({
        page: z.coerce.number().int().min(1).default(1),
        action: z.string().max(100).optional(),
      })
      .parse(req.query);
    const where = {
      ...siteFilter(req),
      ...(q.action ? { action: { contains: q.action } } : {}),
    };
    return {
      items: await db.audit.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (q.page - 1) * 50,
        take: 50,
      }),
      total: await db.audit.count({ where }),
    };
  });
  app.get("/api/admin", async (req) => {
    admin(req);
    const versions = await db.version.aggregate({
      _sum: { size: true },
      _count: true,
    });
    return {
      installationId: await installationId(),
      license: await licenseState(),
      server: {
        node: process.version,
        platform: os.platform(),
        uptime: process.uptime(),
        memory: process.memoryUsage().rss,
        host: config.host,
        port: config.port,
        publicUrl: config.publicUrl,
      },
      storage: { bytes: versions._sum.size || 0, files: versions._count },
      settings: Object.fromEntries(
        (
          await db.setting.findMany({
            where: { key: { in: ["organization", "supportEmail"] } },
          })
        ).map((s) => [s.key, s.value]),
      ),
      backups: await listBackups(),
    };
  });
  app.put("/api/admin/settings", async (req) => {
    admin(req);
    const input = z
      .object({
        organization: text,
        supportEmail: z.union([z.string().email(), z.literal("")]),
      })
      .strict()
      .parse(req.body);
    await db.$transaction(
      Object.entries(input).map(([key, value]) =>
        db.setting.upsert({
          where: { key },
          create: { key, value },
          update: { value },
        }),
      ),
    );
    await audit(req, "settings.update", "organisation");
    return { ok: true };
  });
  app.post("/api/admin/license", async (req) => {
    admin(req);
    try {
      await verifyLicense(req.body, await installationId());
    } catch (e) {
      fail(400, (e as Error).message);
    }
    await db.setting.upsert({
      where: { key: "license" },
      create: { key: "license", value: JSON.stringify(req.body) },
      update: { value: JSON.stringify(req.body) },
    });
    await audit(req, "license.activate", "installation");
    return licenseState();
  });
  app.post("/api/admin/backups", async (req) => {
    admin(req);
    const result = await createBackup(db);
    await audit(req, "backup.create", result.id);
    return result;
  });
  app.post("/api/admin/restore", async (req) => {
    admin(req);
    const input = z
      .object({ id: idSchema, confirmation: z.literal("RESTAURER") })
      .parse(req.body);
    await createBackup(db);
    const result = await restoreBackup(db, input.id);
    await audit(req, "backup.restore", input.id);
    return result;
  });
  const webRoot = path.resolve("dist/web");
  if (
    await stat(webRoot)
      .then((s) => s.isDirectory())
      .catch(() => false)
  ) {
    await app.register(serveStatic, { root: webRoot });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith("/api") || path.extname(req.url.split("?")[0]))
        return reply.code(404).send({ error: "Ressource introuvable." });
      return reply.type("text/html").sendFile("index.html");
    });
  }
  app.addHook("onClose", async () => {
    await db.$disconnect();
  });
  return app;
}
