export const id = "code-review";
export const version = "1";
export const classification = "workflow_recipe";

export function compile({ packet }) {
  if (packet.workflow_definition !== "verification" || packet.role !== "verifier") {
    throw new Error("incompatible_workflow_definition");
  }
  if (JSON.stringify(packet.capabilities ?? []) !== JSON.stringify(["repository_read"])) {
    throw new Error("capability_widening");
  }
  return {
    adapter: "code-review@1",
    role: "verifier",
    attempts: [{ fresh: true, axes: ["standards", "spec"] }],
    effects: [],
  };
}

export default { id, version, classification, compile };
