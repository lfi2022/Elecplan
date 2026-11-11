ALTER TABLE "Location" ADD COLUMN "inheritClient" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Document" ADD COLUMN "referenceHistory" TEXT NOT NULL DEFAULT '[]';
CREATE TABLE "ReferenceReservation" (
  "reference" TEXT NOT NULL PRIMARY KEY,
  "clientId" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT OR IGNORE INTO "ReferenceReservation" ("reference", "clientId") SELECT "reference", "clientId" FROM "Document";
