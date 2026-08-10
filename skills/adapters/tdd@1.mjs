export const id = "tdd";
export const version = "1";
export const classification = "attempt_skill";

export function compile({ packet }) {
  if (packet.role !== "worker" || !["implementation", "repair"].includes(packet.workflow_definition)) {
    throw new Error("incompatible_workflow_definition");
  }
  if (!packet.acceptance_criteria?.some((criterion) => /test|behavior|behaviour/i.test(criterion))) {
    throw new Error("tdd_requires_behavior_acceptance");
  }
  if (packet.capabilities?.includes("local_commit") || packet.capabilities?.includes("external_mutation")) {
    throw new Error("capability_widening");
  }
  return { adapter: "tdd@1", role: "worker", effects: [] };
}

export default { id, version, classification, compile };
