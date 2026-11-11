import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import { promisify } from "node:util";
import type { User } from "@prisma/client";
const scrypt = promisify(scryptCallback);
export const permissions = [
  "locations:write",
  "documents:write",
  "documents:read",
  "documents:download",
  "documents:delete",
  "audit:read",
] as const;
export function can(user: User, permission: string) {
  if (user.role === "ADMIN") return true;
  const defaults =
    user.role === "EDITOR"
      ? permissions.filter((p) => p !== "audit:read")
      : ["documents:read", "documents:download"];
  return [...defaults, ...(JSON.parse(user.permissions) as string[])].includes(
    permission,
  );
}
export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const hash = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt:${salt}:${hash.toString("hex")}`;
}
export async function verifyPassword(password: string, stored: string) {
  const [, salt, hex] = stored.split(":");
  const actual = (await scrypt(password, salt, 64)) as Buffer;
  const expected = Buffer.from(hex, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
export const token = () => randomBytes(32).toString("hex");
export const digest = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");
export function sameSecret(a: string, b: string) {
  return timingSafeEqual(Buffer.from(digest(a)), Buffer.from(digest(b)));
}
