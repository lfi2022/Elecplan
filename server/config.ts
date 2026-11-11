import "dotenv/config";
import path from "node:path";
process.env.CHECKPOINT_DISABLE = "1";
process.env.PRISMA_HIDE_UPDATE_MESSAGE = "true";
export const dataDir = path.resolve(process.env.DATA_DIR || "./data");
process.env.DATABASE_URL ||= `file:${path.join(dataDir, "electroplan.db").replaceAll("\\", "/")}`;
if (!process.env.DATABASE_URL.startsWith("file:"))
  throw new Error("SQLite local requis.");
if (!path.isAbsolute(process.env.DATABASE_URL.slice(5)))
  process.env.DATABASE_URL = `file:${path.resolve("prisma", process.env.DATABASE_URL.slice(5)).replaceAll("\\", "/")}`;
export const config = {
  dataDir,
  filesDir: path.join(dataDir, "files"),
  backupsDir: path.join(dataDir, "backups"),
  publicUrl: process.env.PUBLIC_URL || "http://localhost:3000",
  setupToken: process.env.SETUP_TOKEN || "",
  secure: process.env.COOKIE_SECURE === "true",
  port: Number(process.env.PORT || 3000),
  host: process.env.HOST || "127.0.0.1",
  maxFile: 50 * 1024 * 1024,
};
const publicUrl = new URL(config.publicUrl);
if (
  !["http:", "https:"].includes(publicUrl.protocol) ||
  publicUrl.pathname !== "/" ||
  publicUrl.search ||
  publicUrl.hash ||
  publicUrl.username ||
  publicUrl.password
)
  throw new Error(
    "PUBLIC_URL doit être une origine HTTP(S), sans chemin ni identifiants.",
  );
if (config.secure && publicUrl.protocol !== "https:")
  throw new Error("COOKIE_SECURE exige une PUBLIC_URL HTTPS.");
