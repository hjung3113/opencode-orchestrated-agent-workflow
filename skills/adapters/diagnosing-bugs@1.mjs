export const id = "diagnosing-bugs";
export const version = "1";
export const classification = "attempt_skill";

export function compile({ packet }) {
  if (packet.workflow_definition !== "repair" || packet.role !== "worker") {
    throw new Error("incompatible_workflow_definition");
  }
  if (!Array.isArray(packet.diagnosis_evidence) || packet.diagnosis_evidence.length === 0) {
    throw new Error("diagnosis_requires_evidence");
  }
  return { adapter: "diagnosing-bugs@1", role: "worker", effects: [] };
}

export default { id, version, classification, compile };
