import type { PrismaClient } from "@prisma/client";
import type { FastifyRequest } from "fastify";
import { z } from "zod";
import {
  allowedParents,
  descendantIds,
  locationKinds,
} from "../shared/hierarchy.js";
import { assertClientForSite } from "./clients.js";
function fail(statusCode: number, message: string): never {
  throw Object.assign(new Error(message), { statusCode });
}
const schema = z
  .object({
    name: z.string().trim().min(1).max(200),
    reference: z.string().max(100),
    description: z.string().max(5000),
    kind: z.enum(locationKinds).optional(),
    parentId: z.string().uuid().nullable().optional(),
    clientId: z.string().uuid().nullable().optional(),
    inheritClient: z.boolean().optional(),
  })
  .strict();
export async function editLocation(
  db: PrismaClient,
  req: FastifyRequest,
  id: string,
) {
  const input = schema.parse(req.body),
    old = await db.location.findUnique({
      where: { id: z.string().uuid().parse(id) },
    });
  if (!old || (req.user.role !== "ADMIN" && !req.siteIds.includes(old.siteId)))
    fail(404, "Localisation introuvable.");
  const nodes = await db.location.findMany(),
    ids = descendantIds(nodes, old.id),
    kind = input.kind ?? old.kind,
    parentId = input.parentId === undefined ? old.parentId : input.parentId;
  const clientId = input.clientId === undefined ? old.clientId : input.clientId,
    inheritClient = clientId
      ? false
      : (input.inheritClient ?? old.inheritClient);
  const ownershipChange =
    clientId !== old.clientId ||
    (!clientId && inheritClient !== old.inheritClient);
  if (ownershipChange) {
    if (req.user.role !== "ADMIN")
      fail(403, "Seul un administrateur peut modifier le rattachement client.");
    await assertClientForSite(db, clientId);
  }
  let siteId = old.id;
  if (kind === "SITE") {
    if (req.user.role !== "ADMIN" && old.kind !== "SITE")
      fail(403, "La création d’un site est réservée aux administrateurs.");
    if (parentId) fail(400, "Un site ne peut pas avoir de parent.");
  } else {
    if (!parentId) fail(400, "Un parent est requis.");
    if (ids.has(parentId))
      fail(
        400,
        "Le parent ne peut pas être cet élément ou un de ses descendants.",
      );
    const parent = nodes.find((n) => n.id === parentId);
    if (
      !parent ||
      (req.user.role !== "ADMIN" && !req.siteIds.includes(parent.siteId))
    )
      fail(404, "Parent introuvable.");
    if (!allowedParents[kind].includes(parent.kind))
      fail(400, "Le type de parent est incompatible avec ce niveau.");
    siteId = parent.siteId;
  }
  if (siteId !== old.siteId && req.user.role !== "ADMIN")
    fail(403, "Un déplacement entre sites est réservé aux administrateurs.");
  if (
    nodes.some(
      (node) =>
        node.parentId === id && !allowedParents[node.kind].includes(kind),
    )
  )
    fail(
      409,
      "Ce type est incompatible avec les enfants existants. Déplacez-les ou modifiez leur type au préalable.",
    );
  return db.$transaction(async (tx) => {
    await tx.location.update({
      where: { id },
      data: {
        name: input.name,
        reference: input.reference,
        description: input.description,
        kind,
        parentId,
        clientId,
        inheritClient,
      },
    });
    if (siteId !== old.siteId) {
      await tx.location.updateMany({
        where: { id: { in: [...ids] } },
        data: { siteId },
      });
      await tx.document.updateMany({
        where: { locationId: { in: [...ids] } },
        data: { siteId },
      });
      if (old.kind === "SITE")
        await tx.userSite.deleteMany({ where: { siteId: old.id } });
    }
    const links = await tx.documentEquipment.findMany({
      where: {
        OR: [
          { document: { locationId: { in: [...ids] } } },
          { equipmentId: { in: [...ids] } },
        ],
      },
      include: {
        document: { select: { siteId: true } },
        equipment: { select: { siteId: true, kind: true } },
      },
    });
    if (
      links.some(
        (link) =>
          link.document.siteId !== link.equipment.siteId ||
          !["PANEL", "EQUIPMENT"].includes(link.equipment.kind),
      )
    )
      fail(
        409,
        "Cette modification séparerait un document de ses équipements ou rendrait une association invalide. Modifiez les associations avant le déplacement.",
      );
    return tx.location.findUniqueOrThrow({ where: { id } });
  });
}
