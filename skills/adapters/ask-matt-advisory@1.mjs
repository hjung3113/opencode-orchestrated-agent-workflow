export const id = "ask-matt-advisory";
export const version = "1";
export const classification = "vocabulary";

export function compile({ packet }) {
  if (packet.workflow_definition !== "intake" || packet.role !== "planner" || (packet.capabilities ?? []).length > 0) {
    throw new Error("incompatible_workflow_definition");
  }
  if ((packet.recipe_effects ?? []).length > 0) throw new Error("forbidden_effect");
  return { adapter: "ask-matt-advisory@1", role: "planner", effects: [] };
}

export default { id, version, classification, compile };
