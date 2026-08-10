export const id = "implement";
export const version = "1";
export const classification = "workflow_recipe";

export function compile({ packet }) {
  if (packet.role !== "worker" || !["implementation", "repair"].includes(packet.workflow_definition)) {
    throw new Error("incompatible_workflow_definition");
  }
  if (packet.capabilities?.includes("local_commit") || packet.capabilities?.includes("external_mutation")) {
    throw new Error("capability_widening");
  }
  return { adapter: "implement@1", role: "worker", effects: [] };
}

export default { id, version, classification, compile };
