import type { FastifyInstance, FastifyRequest } from "fastify";
import type { PrismaClient, Prisma } from "@prisma/client";
import { z } from "zod";
import { electricalPlanStages } from "../shared/electricalPlans.js";

function reject(statusCode: number, message: string): never {
  throw Object.assign(new Error(message), { statusCode });
}
const identifier = (max: number) =>
  z
    .string()
    .trim()
    .toUpperCase()
    .min(2)
    .max(max)
    .regex(
      /^[A-Z0-9]+(?:-[A-Z0-9]+)*$/,
      "Lettres A–Z, chiffres et tirets simples uniquement.",
    );
const clientSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    code: identifier(20),
    prefix: identifier(40),
    email: z.union([z.string().email().max(254), z.literal("")]).default(""),
    phone: z.string().max(50).default(""),
    address: z.string().max(1000).default(""),
    description: z.string().max(5000).default(""),
    electricalPlanStage: z.enum(electricalPlanStages).nullable().optional(),
    active: z.boolean().default(true),
  })
  .strict();

export function registerClients(
  app: FastifyInstance,
  db: PrismaClient,
  hooks: {
    admin: (r: FastifyRequest) => void;
    requirePermission: (r: FastifyRequest, p: string) => void;
    audit: (
      r: FastifyRequest,
      action: string,
      target: string,
      siteId?: string,
    ) => Promise<unknown>;
  },
) {
  app.get("/api/clients", async (req) => {
    hooks.requirePermission(req, "documents:read");
    if (req.user.role === "ADMIN")
      return db.client.findMany({
        orderBy: { name: "asc" },
        include: { _count: { select: { sites: true, documents: true } } },
      });
    return db.client.findMany({
      where: {
        OR: [
          { sites: { some: { siteId: { in: req.siteIds } } } },
          { documents: { some: { siteId: { in: req.siteIds } } } },
        ],
      },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        code: true,
        prefix: true,
        active: true,
        electricalPlanStage: true,
      },
    });
  });
  app.post("/api/clients", async (req, reply) => {
    hooks.admin(req);
    const input = clientSchema.parse(req.body);
    const client = await db.client.create({ data: input });
    await hooks.audit(req, "client.create", client.id);
    return reply.code(201).send(client);
  });
  app.put("/api/clients/:id", async (req) => {
    hooks.admin(req);
    const id = z
        .string()
        .uuid()
        .parse((req.params as { id: string }).id),
      input = clientSchema.parse(req.body);
    const old = await db.client.findUnique({ where: { id } });
    if (!old) reject(404, "Client introuvable.");
    const client = await db.client.update({ where: { id }, data: input });
    await hooks.audit(req, "client.update", id);
    return client;
  });
}

export async function assertClientForSite(db: PrismaClient, id: string | null) {
  if (!id) return;
  const client = await db.client.findUnique({ where: { id } });
  if (!client) reject(400, "Client introuvable.");
  if (!client.active) reject(400, "Ce client est désactivé.");
}

export async function allocateReference(
  tx: Prisma.TransactionClient,
  clientId: string,
) {
  const client = await tx.client.findUniqueOrThrow({ where: { id: clientId } });
  if (!client.active)
    reject(
      409,
      "Ce client est désactivé. Réactivez-le avant de créer un document.",
    );
  let number = client.nextNumber;
  let reference = `${client.prefix}-${String(number).padStart(5, "0")}`;
  // Existing free-form references can predate client management; never duplicate them.
  while (
    (await tx.document.findFirst({
      where: { reference },
      select: { id: true },
    })) ||
    (await tx.referenceReservation.findUnique({ where: { reference } }))
  ) {
    number++;
    reference = `${client.prefix}-${String(number).padStart(5, "0")}`;
  }
  if (number >= 2147483647)
    reject(409, "La séquence de références de ce client est épuisée.");
  await tx.client.update({
    where: { id: clientId },
    data: { nextNumber: number + 1 },
  });
  await tx.referenceReservation.create({ data: { reference, clientId } });
  return { clientId, clientNumber: number, reference };
}
