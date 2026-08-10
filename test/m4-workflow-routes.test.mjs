import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import {
  compileWorkflowPacket,
  digest,
  M4_SKILL_MANIFEST,
  publishWorkflowPacket,
  publishKernelArtifact,
  publishRuntimeObservation,
  resolvePinnedSkill,
  runLocalChange,
  selectWorkflowRoute,
} from "../scripts/local-change.mjs";

const zeroDigest = `sha256:${"0".repeat(64)}`;

const implementationSkills = [
  {
    id: "implement",
    version: "1",
    source: "https://github.com/mattpocock/skills.git",
    source_revision: "84fdeffd12f2ee307994d1eb6feb48173b6e0502",
    source_path: "skills/engineering/implement/SKILL.md",
    digest: "sha256:6d3fd9e83b8f36e5213854779db49b256a457a7ebb4a503e53fa7dcff696adc3",
    adapter_id: "implement",
    adapter_version: "1",
  },
  {
    id: "tdd",
    version: "1",
    source: "https://github.com/mattpocock/skills.git",
    source_revision: "84fdeffd12f2ee307994d1eb6feb48173b6e0502",
    source_path: "skills/engineering/tdd/SKILL.md",
    digest: "sha256:5e6b9c16b547113e90afbb946489d1c1384be5c2128f0159bd0bee57251ecf08",
    adapter_id: "tdd",
    adapter_version: "1",
  },
];

function routeArtifact(kind, artifactId = `${kind}-1`, fields = {}) {
  const artifact = { kind, artifact_id: artifactId, ...fields };
  return {
    artifact,
    reference: {
      reference_kind: "artifact",
      artifact_id: artifactId,
      path: `artifacts/${artifactId}.json`,
      digest: digest(artifact),
    },
  };
}

function artifactReference(artifact, path) {
  return {
    reference_kind: "artifact",
    artifact_id: artifact.artifact_id,
    path,
    digest: digest(artifact),
  };
}

function readyTaskBinding(packet, workflowDefinition, taskId = `${workflowDefinition}-1`) {
  const graph = routeArtifact("graph", `graph-${taskId}`, {
    nodes: [{ task_id: taskId, workflow_definition: workflowDefinition, packet_ref: packet.reference }],
  });
  return {
    ready_task: { task_id: taskId, workflow_definition: workflowDefinition, graph },
    state: {
      active_graph_ref: graph.reference,
      tasks: { [taskId]: { task_state: "planned", attempts: 0 } },
    },
  };
}

function manifestSkill(id) {
  const { classification, ...skill } = M4_SKILL_MANIFEST.entries.find((entry) => entry.id === id);
  return {
    ...skill,
    source: M4_SKILL_MANIFEST.repository,
    source_revision: M4_SKILL_MANIFEST.revision,
  };
}

const verificationSkills = [manifestSkill("code-review")];
const repairSkills = [manifestSkill("diagnosing-bugs"), manifestSkill("tdd"), manifestSkill("implement")];


const admittedFindingReview = routeArtifact("review", "review-finding-1", {
  run_id: "run-finding-review-1",
  verdict: "finding",
  findings: [{
    finding_id: "finding-1",
    fingerprint: zeroDigest,
    criterion: "the target matches",
    evidence: [],
  }],
});
const stateWithoutRepair = {
  run_id: "run-finding-review-1",
  tasks: {
    "verification-1": {
      task_state: "artifacts_published",
      attempts: 1,
      artifact_ref: admittedFindingReview.reference,
    },
  },
};

test("Kernel admits a valid implementation Packet with ordered route evidence and skills", () => {
  const packet = routeArtifact("packet");
  const ready = readyTaskBinding(packet, "implementation");
  const route = selectWorkflowRoute({
    request: routeArtifact("request"),
    packet,
    ...ready,
    constraints: {
      role: "worker",
      preset: "local-change@1",
      capabilities: ["repository_read", "local_write", "command_execute"],
      skills: ["implement@1", "tdd@1"],
    },
  });

  assert.deepEqual(route.eligible_workflow_definitions, [{ id: "implementation", version: "1" }]);
  assert.deepEqual(route.route_evidence, {
    evaluated_rule_ids: ["route.ready-task@1"],
    winning_rule_id: "route.ready-task@1",
    workflow_definition_version: "1",
  });

  const compiled = compileWorkflowPacket({
    workflow_definition: "implementation",
    role: "worker",
    preset: "local-change@1",
    capabilities: ["repository_read", "local_write", "command_execute"],
    acceptance_criteria: ["the behavior is covered by a failing then passing test"],
    skills: implementationSkills,
    route_evidence: route.route_evidence,
  });

  assert.equal(compiled.workflow_definition, "implementation@1");
  assert.deepEqual(compiled.skill_order, ["implement@1", "tdd@1"]);
  assert.equal(compiled.attempts.length, 1);
  assert.equal(compiled.attempts[0].role, "worker");
  assert.deepEqual(compiled.omitted_effects, ["commit", "publication", "issue_mutation", "child_agent", "embedded_review"]);
  assert.notEqual(zeroDigest, implementationSkills[0].digest);
});

test("the skill manifest stays closed to the five pinned identities", () => {
  assert.equal(M4_SKILL_MANIFEST.entries.length, 5);
  assert.deepEqual(
    M4_SKILL_MANIFEST.entries.map(({ id, classification }) => `${id}:${classification}`),
    ["ask-matt:vocabulary", "implement:workflow_recipe", "tdd:attempt_skill", "code-review:workflow_recipe", "diagnosing-bugs:attempt_skill"],
  );
  const content = Buffer.from("unlisted but self-consistent bytes\n");
  const entry = {
    id: "unlisted-skill",
    version: "1",
    source: M4_SKILL_MANIFEST.repository,
    source_revision: M4_SKILL_MANIFEST.revision,
    source_path: "skills/unlisted-skill/SKILL.md",
    digest: digest(content),
    adapter_id: "unlisted-skill",
    adapter_version: "1",
  };
  const key = `${entry.source}@${entry.source_revision}:${entry.source_path}`;
  assert.throws(() => resolvePinnedSkill(entry, {
    cache: new Map([[key, {
      repository: entry.source,
      revision: entry.source_revision,
      path: entry.source_path,
      content,
    }]]),
  }), (error) => error.code === "dependency_unavailable");
});

test("pinned skill resolution rejects a cache identity outside the manifest", () => {
  const content = Buffer.from("wrong identity\n");
  for (const field of ["source_revision", "source_path"]) {
    const entry = {
      ...M4_SKILL_MANIFEST.entries[0],
      source: M4_SKILL_MANIFEST.repository,
      source_revision: M4_SKILL_MANIFEST.revision,
      digest: digest(content),
    };
    entry[field] = field === "source_revision" ? "0".repeat(40) : "skills/other/SKILL.md";
    const key = `${entry.source}@${entry.source_revision}:${entry.source_path}`;
    assert.throws(() => resolvePinnedSkill(entry, {
      cache: new Map([[key, {
        repository: entry.source,
        revision: entry.source_revision,
        path: entry.source_path,
        content,
      }]]),
    }), (error) => error.code === "dependency_unavailable");
  }
});

test("Kernel rejects a Packet skill with incomplete pinned provenance", () => {
  const malformed = structuredClone(implementationSkills);
  delete malformed[0].source_path;
  assert.throws(() => compileWorkflowPacket({
    workflow_definition: "implementation",
    role: "worker",
    preset: "local-change@1",
    capabilities: ["repository_read", "local_write", "command_execute"],
    acceptance_criteria: ["behavior is covered by a test"],
    skills: malformed,
    route_evidence: {
      evaluated_rule_ids: ["route.ready-task@1"],
      winning_rule_id: "route.ready-task@1",
      workflow_definition_version: "1",
    },
  }), (error) => error.code === "dependency_unavailable");
});

test("Kernel gives a Finding one Repair and routes its Result to fresh Verification", () => {
  const repair = selectWorkflowRoute({
    request: routeArtifact("request"),
    review: admittedFindingReview,
    state: stateWithoutRepair,
    packet: routeArtifact("packet"),
    ready_task: { workflow_definition: "verification" },
    constraints: {
      role: "worker",
      preset: "local-change@1",
      capabilities: ["repository_read", "local_write", "command_execute"],
    },
  });
  assert.deepEqual(repair.eligible_workflow_definitions, [{ id: "repair", version: "1" }]);
  assert.equal(repair.route_evidence.winning_rule_id, "route.finding-to-repair@1");

  const packet = routeArtifact("packet");
  const result = routeArtifact("result", "result-1", { repair_result: true, run_id: "run-result-1" });
  const verification = selectWorkflowRoute({
    request: routeArtifact("request"),
    packet,
    state: {
      run_id: "run-result-1",
      tasks: { "repair-1": { task_state: "artifacts_published", artifact_ref: result.reference } },
    },
    finding: { admitted: true, repair_task_admitted: true, repair_result_bound: true },
    result,
    constraints: { role: "verifier", preset: "local-change@1", capabilities: ["repository_read"] },
  });
  assert.deepEqual(verification.eligible_workflow_definitions, [{ id: "verification", version: "1" }]);
  assert.equal(verification.route_evidence.winning_rule_id, "route.result-to-verification@1");
});

test("planner hints cannot override the direct Finding-to-Repair route", () => {
  const route = selectWorkflowRoute({
    request: routeArtifact("request"),
    review: admittedFindingReview,
    state: stateWithoutRepair,
    packet: routeArtifact("packet"),
    constraints: {
      role: "worker",
      preset: "local-change@1",
      capabilities: ["repository_read", "local_write", "command_execute"],
    },
    planner_hints: { only: ["implementation"] },
  });
  assert.deepEqual(route.eligible_workflow_definitions, [{ id: "repair", version: "1" }]);
  assert.equal(route.route_evidence.winning_rule_id, "route.finding-to-repair@1");
});

test("Kernel records ordered matching route rules before selecting the winner", () => {
  const packet = routeArtifact("packet");
  const ready = readyTaskBinding(packet, "implementation");
  const route = selectWorkflowRoute({
    request: routeArtifact("request"),
    review: admittedFindingReview,
    state: {
      ...stateWithoutRepair,
      ...ready.state,
      tasks: { ...stateWithoutRepair.tasks, ...ready.state.tasks },
    },
    packet,
    ready_task: ready.ready_task,
    constraints: {
      role: "worker",
      preset: "local-change@1",
      capabilities: ["repository_read", "local_write", "command_execute"],
    },
  });

  assert.deepEqual(route.eligible_workflow_definitions, [{ id: "repair", version: "1" }]);
  assert.deepEqual(route.route_evidence.evaluated_rule_ids, [
    "route.finding-to-repair@1",
    "route.ready-task@1",
  ]);
  assert.equal(route.route_evidence.winning_rule_id, "route.finding-to-repair@1");
});

test("an admitted Repair Task prevents a second Repair candidate", () => {
  const route = selectWorkflowRoute({
    request: routeArtifact("request"),
    review: admittedFindingReview,
    state: {
      run_id: stateWithoutRepair.run_id,
      tasks: {
        ...stateWithoutRepair.tasks,
        "repair-1": { task_state: "planned", attempts: 0 },
      },
      transitions: [{
        event_kind: "repair_admitted",
        record_refs: [admittedFindingReview.reference],
      }],
    },
    packet: routeArtifact("packet"),
    constraints: {
      role: "worker",
      preset: "local-change@1",
      capabilities: ["repository_read", "local_write", "command_execute"],
    },
  });
  assert.deepEqual(route.eligible_workflow_definitions, []);
});

test("a ready Repair Packet cannot duplicate one Finding while a sibling remains eligible", () => {
  const review = routeArtifact("review", "review-ready-repair-findings-1", {
    run_id: "run-ready-repair-1",
    verdict: "finding",
    findings: [
      { finding_id: "finding-ready-1", fingerprint: zeroDigest, criterion: "the first target matches", evidence: [] },
      { finding_id: "finding-ready-2", fingerprint: zeroDigest, criterion: "the second target matches", evidence: [] },
    ],
  });
  const priorRepairPacket = routeArtifact("packet", "packet-ready-repair-prior-1", {
    workflow_definition: "repair",
    finding_ref: review.reference,
    finding_id: "finding-ready-1",
  });
  const request = routeArtifact("request");
  const constraints = {
    role: "worker",
    preset: "local-change@1",
    capabilities: ["repository_read", "local_write", "command_execute"],
  };
  const routeForFinding = (findingId, taskId) => {
    const packet = routeArtifact("packet", `packet-ready-repair-${findingId}`, {
      workflow_definition: "repair",
      finding_ref: review.reference,
      finding_id: findingId,
    });
    const ready = readyTaskBinding(packet, "repair", taskId);
    return selectWorkflowRoute({
      request,
      review,
      finding_id: findingId,
      packet,
      ready_task: ready.ready_task,
      admitted_repair_packets: [priorRepairPacket],
      state: {
        admission_state: "admitted",
        run_id: "run-ready-repair-1",
        ...ready.state,
        tasks: {
          ...ready.state.tasks,
          "verification-ready-repair-1": {
            task_state: "artifacts_published",
            artifact_ref: review.reference,
          },
        },
        transitions: [{
          event_kind: "repair_admitted",
          record_refs: [review.reference, priorRepairPacket.reference],
        }],
      },
      constraints,
    });
  };

  assert.deepEqual(
    routeForFinding("finding-ready-1", "repair-ready-1").eligible_workflow_definitions,
    [],
  );
  assert.deepEqual(
    routeForFinding("finding-ready-2", "repair-ready-2").eligible_workflow_definitions,
    [{ id: "repair", version: "1" }],
  );
});

test("implement adapter rejects a recipe that smuggles a forbidden commit effect", () => {
  assert.throws(() => compileWorkflowPacket({
    workflow_definition: "implementation",
    role: "worker",
    preset: "local-change@1",
    capabilities: ["repository_read", "local_write", "command_execute"],
    acceptance_criteria: ["behavior is covered by a test"],
    recipe_effects: ["commit"],
    skills: implementationSkills,
    route_evidence: {
      evaluated_rule_ids: ["route.ready-task@1"],
      winning_rule_id: "route.ready-task@1",
      workflow_definition_version: "1",
    },
  }), /forbidden_effect/);
});

test("code-review adapter compiles Standards and Spec into one fresh verifier Attempt", () => {
  const source = M4_SKILL_MANIFEST.entries.find(({ id }) => id === "code-review");
  const { classification, ...packetSkill } = source;
  const compiled = compileWorkflowPacket({
    workflow_definition: "verification",
    role: "verifier",
    preset: "local-change@1",
    capabilities: ["repository_read"],
    acceptance_criteria: ["the changed behavior satisfies the contract"],
    skills: [{
      ...packetSkill,
      source: M4_SKILL_MANIFEST.repository,
      source_revision: M4_SKILL_MANIFEST.revision,
    }],
    route_evidence: {
      evaluated_rule_ids: ["route.result-to-verification@1"],
      winning_rule_id: "route.result-to-verification@1",
      workflow_definition_version: "1",
    },
  });

  assert.equal(compiled.attempts.length, 1);
  assert.equal(compiled.attempts[0].fresh, true);
  assert.deepEqual(compiled.attempts[0].axes, ["standards", "spec"]);
  assert.deepEqual(compiled.attempts[0].skills, ["code-review@1"]);
});

test("an adapter-incompatible Packet fails as dependency_unavailable", () => {
  const source = M4_SKILL_MANIFEST.entries.find(({ id }) => id === "code-review");
  const { classification, ...packetSkill } = source;
  assert.throws(() => compileWorkflowPacket({
    workflow_definition: "implementation",
    role: "worker",
    preset: "local-change@1",
    capabilities: ["repository_read", "local_write", "command_execute"],
    acceptance_criteria: ["the changed behavior is covered by a test"],
    skills: [{
      ...packetSkill,
      source: M4_SKILL_MANIFEST.repository,
      source_revision: M4_SKILL_MANIFEST.revision,
    }],
  }), (error) => error.code === "dependency_unavailable");
});

test("a Packet missing its required skill fails as dependency_unavailable", () => {
  assert.throws(() => compileWorkflowPacket({
    workflow_definition: "implementation",
    role: "worker",
    preset: "local-change@1",
    capabilities: ["repository_read", "local_write", "command_execute"],
    acceptance_criteria: ["the changed behavior is covered by a test"],
  }), (error) => error.code === "dependency_unavailable");
});

test("repair Packet skill order keeps diagnosis and TDD before implementation", () => {
  const skill = (id) => {
    const source = M4_SKILL_MANIFEST.entries.find((entry) => entry.id === id);
    const { classification, ...packetSkill } = source;
    return {
      ...packetSkill,
      source: M4_SKILL_MANIFEST.repository,
      source_revision: M4_SKILL_MANIFEST.revision,
    };
  };
  assert.throws(() => compileWorkflowPacket({
    workflow_definition: "repair",
    role: "worker",
    preset: "local-change@1",
    capabilities: ["repository_read", "local_write", "command_execute"],
    acceptance_criteria: ["the changed behavior is covered by a test"],
    diagnosis_evidence: ["finding-evidence-1"],
    skills: [skill("implement"), skill("diagnosing-bugs"), skill("tdd")],
  }), (error) => error.code === "dependency_unavailable");
});

test("ask-matt advisory remains vocabulary-only with no effects", () => {
  const source = M4_SKILL_MANIFEST.entries.find(({ id }) => id === "ask-matt");
  const { classification, ...packetSkill } = source;
  const compiled = compileWorkflowPacket({
    workflow_definition: "intake",
    role: "planner",
    capabilities: [],
    acceptance_criteria: ["the request is bounded"],
    skills: [{
      ...packetSkill,
      source: M4_SKILL_MANIFEST.repository,
      source_revision: M4_SKILL_MANIFEST.revision,
    }],
    route_evidence: {
      evaluated_rule_ids: ["route.pre-intake@1"],
      winning_rule_id: "route.pre-intake@1",
      workflow_definition_version: "1",
    },
  });

  assert.deepEqual(compiled.attempts[0].effects, []);
});

test("ask-matt advisory rejects a recipe effect", () => {
  const source = M4_SKILL_MANIFEST.entries.find(({ id }) => id === "ask-matt");
  const { classification, ...packetSkill } = source;
  assert.throws(() => compileWorkflowPacket({
    workflow_definition: "intake",
    role: "planner",
    capabilities: [],
    acceptance_criteria: ["the request is bounded"],
    recipe_effects: ["edit"],
    skills: [{
      ...packetSkill,
      source: M4_SKILL_MANIFEST.repository,
      source_revision: M4_SKILL_MANIFEST.revision,
    }],
  }), (error) => error.code === "dependency_unavailable");
});

test("Kernel computes skill-compatible candidates before planner hints narrow them", () => {
  const context = {
    request: routeArtifact("request"),
    packet: routeArtifact("packet"),
    constraints: {
      role: "worker",
      preset: "local-change@1",
      capabilities: ["repository_read", "local_write", "command_execute"],
      skills: ["code-review@1"],
    },
  };
  assert.deepEqual(selectWorkflowRoute(context).eligible_workflow_definitions, []);

  const eligible = selectWorkflowRoute({
    ...context,
    constraints: { ...context.constraints, skills: ["implement@1"] },
  });
  assert.deepEqual(eligible.eligible_workflow_definitions, [
    { id: "implementation", version: "1" },
  ]);
  assert.deepEqual(
    selectWorkflowRoute({ ...context, constraints: { ...context.constraints, skills: ["implement@1"] }, planner_hints: { only: ["implementation"] } }).eligible_workflow_definitions,
    [{ id: "implementation", version: "1" }],
  );
});

test("Kernel rejects a ready Task with an unpinned Workflow Definition version", () => {
  const route = selectWorkflowRoute({
    request: routeArtifact("request"),
    ready_task: { workflow_definition: { id: "implementation", version: "2" } },
    constraints: {
      role: "worker",
      preset: "local-change@1",
      capabilities: ["repository_read", "local_write", "command_execute"],
      skills: ["implement@1"],
    },
  });
  assert.deepEqual(route.eligible_workflow_definitions, []);
});

test("route selection requires the admitted implementation role and local-change preset", () => {
  const route = selectWorkflowRoute({
    request: routeArtifact("request"),
    packet: routeArtifact("packet"),
    constraints: { capabilities: ["repository_read", "local_write", "command_execute"] },
  });
  assert.deepEqual(route.eligible_workflow_definitions, []);
});

test("Kernel enforces Workflow Definition input kinds before eligibility", () => {
  const implementationWithoutPacket = selectWorkflowRoute({
    request: routeArtifact("request"),
    ready_task: { workflow_definition: "implementation" },
    constraints: {
      role: "worker",
      preset: "local-change@1",
      capabilities: ["repository_read", "local_write", "command_execute"],
      skills: ["implement@1"],
    },
  });
  assert.deepEqual(implementationWithoutPacket.eligible_workflow_definitions, []);

  const repairWithoutReview = selectWorkflowRoute({
    request: routeArtifact("request"),
    constraints: {
      role: "worker",
      preset: "local-change@1",
      capabilities: ["repository_read", "local_write", "command_execute"],
    },
  });
  assert.deepEqual(repairWithoutReview.eligible_workflow_definitions, []);

  const repairWithInputs = selectWorkflowRoute({
    request: routeArtifact("request"),
    review: admittedFindingReview,
    state: stateWithoutRepair,
    packet: routeArtifact("packet"),
    constraints: {
      role: "worker",
      preset: "local-change@1",
      capabilities: ["repository_read", "local_write", "command_execute"],
    },
  });
  assert.deepEqual(repairWithInputs.eligible_workflow_definitions, [{ id: "repair", version: "1" }]);
});

test("intake Packet publication can route from the admitted pre-intake bootstrap", () => {
  const runDir = mkdtempSync(join(tmpdir(), "m4-intake-publication-"));
  mkdirSync(join(runDir, "artifacts"));
  const packet = {
    schema_version: "1.0",
    kind: "packet",
    artifact_id: "packet-intake-publication-1",
    run_id: "run-intake-publication-1",
    graph_revision: 1,
    task_id: "intake-publication-1",
    producer: { role: "planner", actor_id: "planner-intake-publication-1" },
    runtime_ref: {
      reference_kind: "repository",
      repository_snapshot: zeroDigest,
      path: "runtime.json",
      digest: zeroDigest,
    },
    input_refs: [],
    created_at: "2026-08-10T00:00:00Z",
    role: "planner",
    workflow_definition: "intake",
    objective: "bound the request",
    acceptance_criteria: ["the request is bounded"],
    allowed_resources: [],
    forbidden_resources: [".git"],
    skills: [],
    capabilities: [],
    admitted_commands: [],
    deadline_seconds: 30,
    escalation_condition: "stop on material ambiguity",
    route_evidence: {
      evaluated_rule_ids: ["route.pre-intake@1"],
      winning_rule_id: "route.pre-intake@1",
      workflow_definition_version: "1",
    },
  };

  const reference = publishWorkflowPacket(
    { runDir },
    "tasks/intake-publication-1/packet.json",
    packet,
    {
      human_request: routeArtifact("human_request", "human-request-intake-publication-1"),
      packet: { artifact: packet, reference: artifactReference(packet, "artifacts/tasks/intake-publication-1/packet.json") },
      constraints: { role: "planner", capabilities: [] },
    },
  );
  assert.equal(reference.artifact_id, packet.artifact_id);
  assert.equal(existsSync(join(runDir, "artifacts/tasks/intake-publication-1/packet.json")), true);
});

test("Packet publication rejects changed pinned skill source", () => {
  const runDir = mkdtempSync(join(tmpdir(), "m4-packet-source-changed-"));
  mkdirSync(join(runDir, "artifacts"));
  const packet = {
    kind: "packet",
    artifact_id: "packet-source-check-1",
    workflow_definition: "implementation",
    role: "worker",
    capabilities: ["repository_read", "local_write", "command_execute"],
    acceptance_criteria: ["behavior is covered by a test"],
    skills: implementationSkills,
    route_evidence: {
      evaluated_rule_ids: ["route.compatible-candidates@1"],
      winning_rule_id: "route.compatible-candidates@1",
      workflow_definition_version: "1",
    },
  };
  const packetPath = "artifacts/tasks/task-source-check-1/packet.json";
  const routeInput = {
    request: routeArtifact("request"),
    packet: { artifact: packet, reference: artifactReference(packet, packetPath) },
    constraints: {
      role: "worker",
      preset: "local-change@1",
      capabilities: packet.capabilities,
      skills: ["implement@1", "tdd@1"],
    },
  };

  assert.throws(
    () => publishWorkflowPacket(
      { runDir },
      packetPath,
      packet,
      routeInput,
      {
        cache: (entry) => ({
          repository: entry.source,
          revision: entry.source_revision,
          path: entry.source_path,
          content: Buffer.from("changed pinned source\n"),
        }),
      },
    ),
    (error) => error?.code === "dependency_unavailable",
  );
  assert.equal(existsSync(join(runDir, packetPath)), false);
});
test("the shared Kernel publication path validates Packet and Runtime Observation provenance", () => {
  const runDir = mkdtempSync(join(tmpdir(), "m4-kernel-publication-"));
  mkdirSync(join(runDir, "artifacts"));
  const routeInput = {
    request: routeArtifact("request"),
    packet: routeArtifact("packet"),
    ready_task: { workflow_definition: "implementation" },
    constraints: {
      role: "worker",
      preset: "local-change@1",
      capabilities: ["repository_read", "local_write", "command_execute"],
      skills: ["implement@1", "tdd@1"],
    },
  };
  const stalePacket = {
    kind: "packet",
    workflow_definition: "implementation",
    route_evidence: {
      evaluated_rule_ids: ["route.result-to-verification@1"],
      winning_rule_id: "route.result-to-verification@1",
      workflow_definition_version: "1",
    },
  };
  assert.throws(
    () => publishKernelArtifact(
      { runDir },
      "tasks/task-1/packet.json",
      stalePacket,
      { routeInput },
    ),
    /route_evidence/,
  );

  const observation = {
    kind: "runtime_observation",
    skill_invocations: [
      { skill_ref: { id: "tdd", version: "1" }, adapter_id: "tdd", adapter_version: "1", invocation_index: 1, evidence_refs: [{}] },
      { skill_ref: { id: "implement", version: "1" }, adapter_id: "implement", adapter_version: "1", invocation_index: 2, evidence_refs: [{}] },
    ],
  };
  assert.throws(
    () => publishKernelArtifact(
      { runDir },
      "runtime/worker-1.json",
      observation,
      { packet: { skills: implementationSkills } },
    ),
    /invocation_order/,
  );
  assert.deepEqual(readdirSync(join(runDir, "artifacts")), []);
});

test("public Kernel Packet publication rejects an unresolved skill before admission", () => {
  const runDir = mkdtempSync(join(tmpdir(), "m4-kernel-source-"));
  mkdirSync(join(runDir, "artifacts"));
  const packet = {
    kind: "packet",
    artifact_id: "packet-kernel-source-1",
    workflow_definition: "implementation",
    role: "worker",
    capabilities: ["repository_read", "local_write", "command_execute"],
    acceptance_criteria: ["behavior is covered by a test"],
    skills: implementationSkills,
    route_evidence: {
      evaluated_rule_ids: ["route.compatible-candidates@1"],
      winning_rule_id: "route.compatible-candidates@1",
      workflow_definition_version: "1",
    },
  };

  assert.throws(
    () => publishKernelArtifact(
      { runDir },
      "tasks/task-1/packet.json",
      packet,
      {
        routeInput: {
          request: routeArtifact("request"),
          packet: {
            artifact: packet,
            reference: artifactReference(packet, "artifacts/tasks/task-1/packet.json"),
          },
          constraints: {
            role: "worker",
            preset: "local-change@1",
            capabilities: packet.capabilities,
            skills: ["implement@1", "tdd@1"],
          },
        },
      },
    ),
    (error) => error?.code === "dependency_unavailable",
  );
  assert.equal(existsSync(join(runDir, "artifacts/tasks/task-1/packet.json")), false);
});

test("Kernel rejects a skill manifest class that disagrees with its adapter", () => {
  const entry = M4_SKILL_MANIFEST.entries.find(({ id }) => id === "implement");
  const originalClassification = entry.classification;
  entry.classification = "attempt_skill";
  try {
    assert.throws(
      () => compileWorkflowPacket({
        workflow_definition: "implementation",
        role: "worker",
        preset: "local-change@1",
        capabilities: ["repository_read", "local_write", "command_execute"],
        acceptance_criteria: ["behavior is covered by a test"],
        skills: implementationSkills,
        route_evidence: {
          evaluated_rule_ids: ["route.ready-task@1"],
          winning_rule_id: "route.ready-task@1",
          workflow_definition_version: "1",
        },
      }),
      /classification/,
    );
  } finally {
    entry.classification = originalClassification;
  }
});

test("Kernel does not make a truthy but unadmitted Finding repair-eligible", () => {
  const route = selectWorkflowRoute({
    request: routeArtifact("request"),
    finding: { admitted: "yes", repair_task_admitted: false, repair_result_bound: false },
    review: routeArtifact("review"),
    packet: routeArtifact("packet"),
    constraints: {
      role: "worker",
      preset: "local-change@1",
      capabilities: ["repository_read", "local_write", "command_execute"],
    },
  });

  assert.equal(
    route.eligible_workflow_definitions.some(({ id }) => id === "repair"),
    false,
  );
});

test("intake Kernel compatibility forbids repository_read", () => {
  assert.throws(
    () => compileWorkflowPacket({
      workflow_definition: "intake",
      role: "planner",
      capabilities: ["repository_read"],
      acceptance_criteria: ["the request is bounded"],
      route_evidence: {
        evaluated_rule_ids: ["route.pre-intake@1"],
        winning_rule_id: "route.pre-intake@1",
        workflow_definition_version: "1",
      },
    }),
    /capability_widening/,
  );
});

test("Runtime Observation publication resolves the admitted Packet and requires its invocation evidence", () => {
  const runDir = mkdtempSync(join(tmpdir(), "m4-authoritative-packet-"));
  mkdirSync(join(runDir, "artifacts/tasks/task-1"), { recursive: true });
  const packet = {
    schema_version: "1.0",
    kind: "packet",
    artifact_id: "packet-authoritative-1",
    run_id: "run-authoritative-1",
    graph_revision: 1,
    task_id: "task-1",
    producer: { role: "planner", actor_id: "planner-1" },
    input_refs: [],
    runtime_ref: {
      reference_kind: "repository",
      repository_snapshot: zeroDigest,
      path: "runtime.json",
      digest: zeroDigest,
    },
    created_at: "2026-08-10T00:00:00Z",
    role: "worker",
    workflow_definition: "implementation",
    objective: "implement the bounded behavior",
    acceptance_criteria: ["behavior is covered by a test"],
    allowed_resources: ["src"],
    forbidden_resources: [".git"],
    skills: implementationSkills,
    capabilities: ["repository_read", "local_write", "command_execute"],
    admitted_commands: [],
    deadline_seconds: 30,
    escalation_condition: "stop on an undeclared change",
    route_evidence: {
      evaluated_rule_ids: ["route.ready-task@1"],
      winning_rule_id: "route.ready-task@1",
      workflow_definition_version: "1",
    },
  };
  writeFileSync(join(runDir, "artifacts/tasks/task-1/packet.json"), `${JSON.stringify(packet)}\n`);
  const packetRef = {
    reference_kind: "artifact",
    artifact_id: packet.artifact_id,
    path: "artifacts/tasks/task-1/packet.json",
    digest: digest(packet),
  };
  const observation = {
    schema_version: "1.0",
    kind: "runtime_observation",
    artifact_id: "runtime-authoritative-1",
    run_id: packet.run_id,
    producer: { role: "runtime", actor_id: "runtime-1" },
    input_refs: [],
    created_at: "2026-08-10T00:00:00Z",
    attempt_id: "worker-1",
    task_id: "task-1",
    attempt: 1,
    role: "worker",
    opencode_version: "1.18.5",
    configuration_digest: zeroDigest,
    session_id: "session-1",
    agent_identity: "worker-1",
    message_ids: [],
    agent: "worker",
    runtime_permission_events: [],
    command_executions: [],
    observed_changes: [],
    observed_output_snapshot: zeroDigest,
    external_reads: [],
    exit_reason: "idle",
    skill_invocations: [],
  };

  assert.throws(
    () => publishRuntimeObservation(
      { runDir, authoritative_packet_ref: packetRef },
      "artifacts/runtime/authoritative-1.json",
      observation,
      { skills: [] },
    ),
    /invocation_order/,
  );
  assert.equal(existsSync(join(runDir, "artifacts/runtime/authoritative-1.json")), false);
});

test("an admitted Review makes its targeted Result ineligible for duplicate Verification", () => {
  const result = routeArtifact("result", "stale-result-1", {
    run_id: "run-reviewed-result-1",
    output_snapshot: zeroDigest,
  });
  const review = routeArtifact("review", "review-for-stale-result-1", {
    run_id: "run-reviewed-result-1",
    target_task_ref: result.reference,
    verdict: "pass",
    findings: [],
  });
  const route = selectWorkflowRoute({
    request: routeArtifact("request"),
    packet: routeArtifact("packet"),
    result,
    review,
    state: {
      run_id: "run-reviewed-result-1",
      tasks: {
        "implementation-1": { task_state: "artifacts_published", artifact_ref: result.reference },
        "verification-9": { task_state: "artifacts_published", artifact_ref: review.reference },
      },
    },
    constraints: { role: "verifier", preset: "local-change@1", capabilities: ["repository_read"] },
  });
  assert.deepEqual(route.eligible_workflow_definitions, []);
  assert.notEqual(route.route_evidence.winning_rule_id, "route.result-to-verification@1");
});

test("Packet publication rejects route context bound to a different Packet", () => {
  const runDir = mkdtempSync(join(tmpdir(), "m4-route-binding-"));
  mkdirSync(join(runDir, "artifacts"));
  const packet = {
    schema_version: "1.0",
    kind: "packet",
    artifact_id: "packet-intake-1",
    run_id: "run-intake-1",
    producer: { role: "planner", actor_id: "planner-intake-1" },
    input_refs: [],
    runtime_ref: {
      reference_kind: "repository",
      repository_snapshot: zeroDigest,
      path: "runtime.json",
      digest: zeroDigest,
    },
    created_at: "2026-08-10T00:00:00Z",
    graph_revision: 1,
    task_id: "intake-1",
    role: "planner",
    workflow_definition: "intake",
    objective: "bound the request",
    acceptance_criteria: ["the request is bounded"],
    allowed_resources: [],
    forbidden_resources: [".git"],
    skills: [],
    capabilities: [],
    admitted_commands: [],
    deadline_seconds: 30,
    escalation_condition: "stop on material ambiguity",
    route_evidence: {
      evaluated_rule_ids: ["route.pre-intake@1"],
      winning_rule_id: "route.pre-intake@1",
      workflow_definition_version: "1",
    },
  };

  assert.throws(
    () => publishWorkflowPacket(
      { runDir },
      "tasks/intake-1/packet.json",
      packet,
      {
        human_request: routeArtifact("human_request"),
        packet: routeArtifact("packet", "stale-packet-1"),
        constraints: { role: "planner", capabilities: [] },
      },
    ),
    /route|admitted|binding/i,
  );
  assert.equal(existsSync(join(runDir, "artifacts/tasks/intake-1/packet.json")), false);
});

test("Packet publication cannot bypass a durable Material Decision for implementation", () => {
  const runDir = mkdtempSync(join(tmpdir(), "m4-material-decision-"));
  mkdirSync(join(runDir, "artifacts"));
  const packetPath = "artifacts/tasks/material-decision-1/packet.json";
  const packet = {
    kind: "packet",
    artifact_id: "packet-material-decision-1",
    role: "worker",
    workflow_definition: "implementation",
    capabilities: ["repository_read", "local_write", "command_execute"],
    route_evidence: {
      evaluated_rule_ids: ["route.material-decision-required@1"],
      winning_rule_id: "route.material-decision-required@1",
    },
  };
  const decision = routeArtifact("outcome", "outcome-material-decision-1", {
    outcome_kind: "material_decision_request",
  });
  const routeInput = {
    request: null,
    material_decision: decision,
    state: {
      admission_state: "admitted",
      lifecycle_state: "material_decision_required",
      transitions: [{
        event_kind: "material_decision_requested",
        record_refs: [decision.reference],
      }],
    },
    packet: { artifact: packet, reference: artifactReference(packet, packetPath) },
    constraints: {
      role: packet.role,
      preset: "local-change@1",
      capabilities: packet.capabilities,
    },
  };

  assert.throws(
    () => publishWorkflowPacket({ runDir }, packetPath, packet, routeInput),
    (error) => error?.message?.startsWith("route_evidence:"),
  );
  assert.equal(existsSync(join(runDir, packetPath)), false);
});
test("M4 compilation rejects duplicate and reordered skill composition", () => {
  for (const skills of [
    [...implementationSkills, implementationSkills[0]],
    [implementationSkills[1], implementationSkills[0]],
  ]) {
    assert.throws(() => compileWorkflowPacket({
      workflow_definition: "implementation",
      role: "worker",
      preset: "local-change@1",
      capabilities: ["repository_read", "local_write", "command_execute"],
      acceptance_criteria: ["the behavior is covered by a test"],
      skills,
      route_evidence: {
        evaluated_rule_ids: ["route.ready-task@1"],
        winning_rule_id: "route.ready-task@1",
        workflow_definition_version: "1",
      },
    }), /composition|skill_order|duplicate/i);
  }
});

test("Runtime Observation publication rejects an unadmitted authoritative Packet object", () => {
  const runDir = mkdtempSync(join(tmpdir(), "m4-unadmitted-packet-"));
  mkdirSync(join(runDir, "artifacts"));
  const evidenceRef = {
    reference_kind: "repository",
    repository_snapshot: zeroDigest,
    path: "evidence.txt",
    digest: zeroDigest,
  };
  const observation = {
    schema_version: "1.0",
    kind: "runtime_observation",
    artifact_id: "runtime-unadmitted-1",
    run_id: "run-unadmitted-1",
    producer: { role: "runtime", actor_id: "runtime-1" },
    input_refs: [],
    created_at: "2026-08-10T00:00:00Z",
    attempt_id: "worker-1",
    task_id: "task-1",
    attempt: 1,
    role: "worker",
    opencode_version: "1.18.5",
    configuration_digest: zeroDigest,
    session_id: "session-1",
    agent_identity: "worker-1",
    message_ids: [],
    agent: "worker",
    runtime_permission_events: [],
    command_executions: [],
    observed_changes: [],
    observed_output_snapshot: zeroDigest,
    external_reads: [],
    exit_reason: "idle",
    skill_invocations: implementationSkills.map((skill, index) => ({
      skill_ref: { id: skill.id, version: skill.version },
      adapter_id: skill.adapter_id,
      adapter_version: skill.adapter_version,
      invocation_index: index + 1,
      outcome: "completed",
      evidence_refs: [evidenceRef],
    })),
  };

  assert.throws(
    () => publishRuntimeObservation(
      { runDir, authoritative_packet: { kind: "packet", skills: implementationSkills } },
      "runtime/unadmitted-1.json",
      observation,
    ),
    /admitted Packet|invocation_order/,
  );
  assert.equal(existsSync(join(runDir, "artifacts/runtime/unadmitted-1.json")), false);
});
