import {
  electricalPlanStageLabels,
  type ElectricalPlanStage,
} from "../../shared/electricalPlans";
export function ElectricalPlanStageBadge({
  stage,
}: {
  stage?: ElectricalPlanStage | null;
}) {
  return (
    <span
      className={`status electrical-plan-stage ${stage === "FINAL" ? "green" : stage === "PROVISIONAL" ? "amber" : "gray"}`}
      title="Caractère du document : provisoire ou définitif"
    >
      {stage ? electricalPlanStageLabels[stage] : "Non renseigné"}
    </span>
  );
}
