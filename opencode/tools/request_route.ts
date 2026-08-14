import { tool } from "@opencode-ai/plugin";
import { requestRoute } from "../../bin/opencode-orchestrator.mjs";

export default tool({
  description: "Submit the current worker's bounded replan proposal.",
  args: {
    recommended_workflow_definition: tool.schema.string(),
    reason: tool.schema.string(),
    evidence_refs: tool.schema.array(tool.schema.string()),
    required_capability: tool.schema.string(),
  },
  async execute(args) {
    const result = requestRoute({
      runDir: process.env.ORCHESTRATOR_RUN_DIR,
      runId: process.env.ORCHESTRATOR_RUN_ID,
      attemptId: process.env.ORCHESTRATOR_ATTEMPT_ID,
    }, args);
    return JSON.stringify(result);
  },
});
