export function finalReceipt(runId, graph) {
  const selected = graph.tasks.find((task) => task.id === graph.selected_task);
  return {
    run_id: runId,
    graph_revision: graph.revision,
    selected_task: {
      id: selected.id,
      execution_state: selected.execution_state,
      acceptance_state: selected.acceptance_state,
      evidence_claim_path: selected.evidence_claim.path,
      verification_path: selected.verification.path,
    },
    unrouted_tasks: graph.tasks.filter((task) => task.execution_state === 'blocked').map((task) => task.id),
  };
}
