ALTER TABLE "Client" ADD COLUMN "electricalPlanStage" TEXT CHECK ("electricalPlanStage" IS NULL OR "electricalPlanStage" IN ('PROVISIONAL', 'FINAL'));
ALTER TABLE "Location" ADD COLUMN "electricalPlanStage" TEXT CHECK ("electricalPlanStage" IS NULL OR "electricalPlanStage" IN ('PROVISIONAL', 'FINAL'));
