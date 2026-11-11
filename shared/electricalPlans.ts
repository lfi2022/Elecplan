export const electricalPlanStages = ["PROVISIONAL", "FINAL"] as const;
export type ElectricalPlanStage = (typeof electricalPlanStages)[number];
export const electricalPlanStageLabels: Record<ElectricalPlanStage, string> = {
  PROVISIONAL: "Provisoire",
  FINAL: "Définitif",
};
