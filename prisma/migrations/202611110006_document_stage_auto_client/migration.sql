-- Preserve former folder settings for rollback without classifying any document by inference.
INSERT OR IGNORE INTO "Setting" ("key", "value") SELECT 'legacy:electricalStage:client:' || "id", json_object('electricalPlanStage', "electricalPlanStage") FROM "Client" WHERE "electricalPlanStage" IS NOT NULL;
INSERT OR IGNORE INTO "Setting" ("key", "value") SELECT 'legacy:electricalStage:location:' || "id", json_object('electricalPlanStage', "electricalPlanStage") FROM "Location" WHERE "electricalPlanStage" IS NOT NULL;
ALTER TABLE "Document" ADD COLUMN "electricalPlanStage" TEXT CHECK ("electricalPlanStage" IS NULL OR "electricalPlanStage" IN ('PROVISIONAL', 'FINAL'));
ALTER TABLE "Client" DROP COLUMN "electricalPlanStage";
ALTER TABLE "Location" DROP COLUMN "electricalPlanStage";
