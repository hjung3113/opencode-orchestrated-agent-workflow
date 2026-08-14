import { tool } from "@opencode-ai/plugin";
import { invokeOperator } from "opencode-orchestrated-agent-workflow/operator";

export default tool({
  description: "Run, inspect, resume, or cancel the file-backed orchestrator.",
  args: {
    action: tool.schema.enum(["run", "status", "resume", "cancel"]),
    request: tool.schema.string().optional(),
    run_id: tool.schema.string().optional(),
    decision: tool.schema.object({
      disposition: tool.schema.enum(["accepted", "rejected"]),
      text: tool.schema.string(),
    }).optional(),
  },
  async execute(args, context) {
    return JSON.stringify(await invokeOperator(args, {
      target: process.env.ORCHESTRATOR_TARGET ?? context.directory,
      runRoot: process.env.ORCHESTRATOR_RUN_ROOT,
      call_id: context.messageID,
    }));
  },
});
