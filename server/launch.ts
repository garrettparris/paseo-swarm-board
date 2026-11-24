import type { PaseoAgent, PaseoApi } from "@getpaseo/client";
import { defineAgentTool } from "@getpaseo/plugin/server";
import { getParentAddressFromLabels } from "@getpaseo/protocol/agent-labels";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { z } from "zod";
import { findLinearIssue, memberName, swarmStage } from "../shared/board.ts";
import { briefText, modelConfig, roleModels } from "../shared/launch.ts";
import type { openSwarmBoard } from "./board.ts";
import { assignmentScope, planningPrompt, rolePrompt } from "../shared/workflow.ts";

type ModelConfig = z.infer<typeof modelConfig>;
type RoleModels = z.infer<typeof roleModels>;

function inheritedModel(agent: PaseoAgent): ModelConfig {
  if (!agent.model) throw new Error("Select a model in the originating agent or configure the role in models.json.");
  return {
    provider: `${agent.provider}/${agent.model}`,
    thinkingOptionId: agent.thinkingOptionId ?? undefined,
  };
}

export function selectModel(override: ModelConfig | undefined, preferred: ModelConfig | undefined, fallback: PaseoAgent) {
  return override ?? preferred ?? inheritedModel(fallback);
}

export function readModels(file: string): RoleModels {
  try {
    return roleModels.parse(JSON.parse(readFileSync(file, "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw new Error("Swarm Board could not read models.json. Check its schema and provider/model values.");
  }
}

export async function startLead(paseo: PaseoApi, sourceId: string, brief: string, models: RoleModels, stage: z.infer<typeof swarmStage> = "execution") {
  const source = (await paseo.agents.ref(sourceId).refresh())?.agent;
  if (!source?.workspaceId || source.archivedAt || source.background) {
    throw new Error("Start the swarm from a visible agent in the target workspace.");
  }
  const followsPlan = source.labels["swarm/stage"] === "planning" && stage === "execution";
  if (source.labels["swarm/member"] && !followsPlan) {
    throw new Error("This chat is already part of a swarm. Start a new run from a separate chat.");
  }
  const issue = findLinearIssue(brief) ?? (followsPlan ? findLinearIssue(source.labels["swarm/issue"] ?? "") : undefined);
  const leadLine = brief.replace(issue?.url ?? "", "").trim().split("\n")[0];
  const work = leadLine.replace(/^[\s:–—-]+/, "").trim().slice(0, 90) || issue?.identifier || brief.slice(0, 90);
  const config = selectModel(undefined, models.lead, source);
  const lead = paseo.agents.ref(sourceId);
  const agent = await paseo.workspaces.ref(source.workspaceId).agents.create({
    config,
    parent: lead,
    title: `${stage === "planning" ? "Plan" : "Swarm"} · ${work.slice(0, 50)}`,
    labels: {
      "swarm/work": work,
      "swarm/role": "lead",
      "swarm/member": "lead",
      "swarm/stage": stage,
      ...(issue ? { "swarm/issue": issue.url } : {}),
    },
    background: false,
    prompt: stage === "planning"
      ? `${planningPrompt} Use report_swarm_result for a blocking human choice and again with decision-resolved after the user answers. Send the reviewed plan or its location back to the originating chat using the same tool.\n\nUser brief:\n${brief}`
      : `The user started this swarm from Paseo. Carry out their request within the stated scope. The originating chat is ${sourceId}. Give the final summary there via Paseo when available.\n\nUser brief:\n${brief}`,
  });
  return { leadId: agent.id };
}

const launchInput = z.object({
  name: memberName.refine((name) => name !== "lead"),
  role: z.enum(["specialist", "worker", "verifier"]),
  brief: briefText,
  model: modelConfig.omit({ options: true }).optional(),
});

export function launchTool(
  membership: { role: string; runId: string },
  agentId: string,
  work: string,
  board: ReturnType<typeof openSwarmBoard>,
  modelsFile: string,
) {
  return defineAgentTool({
    name: "launch_swarm_member",
    description: "Start one scoped teammate. Leads launch specialists or verifiers. Specialists launch workers. Supply a provider/model override only for a model choice authorized for this run. The board uses the member name for mentions.",
    input: launchInput,
    async execute({ name, role, brief, model }, { agent, paseo }) {
      if (agent.id !== agentId) throw new Error("This tool belongs to a different session.");
      const parentRole = role === "worker" ? "specialist" : "lead";
      if (membership.role !== parentRole) throw new Error(`Only the ${parentRole} role can launch a ${role}.`);
      const existing = board.get(membership.runId)?.members.find((member) => member.name === name);
      if (existing) {
        const snapshot = (await paseo.agents.ref(existing.agentId).refresh())?.agent;
        if (snapshot && !snapshot.archivedAt) {
          return { text: `@${name} is already in this run. Check its scope and use the board to resume it.`, structuredContent: { agentId: existing.agentId, existing: true } };
        }
        throw new Error(`@${name} is reserved by a previous launch. Check its session before assigning a replacement name.`);
      }
      const parent = paseo.agents.ref(agentId);
      const leader = (await paseo.agents.ref(membership.runId).refresh())?.agent;
      if (!leader) throw new Error("The lead session is unavailable.");
      const config = selectModel(model, readModels(modelsFile)[role], leader);
      const idempotencyKey = createHash("sha256").update(`${agentId}:${name}`).digest("hex");
      if (!agent.workspaceId) throw new Error("The parent session has no workspace.");
      const child = await paseo.workspaces.ref(agent.workspaceId).agents.create({
        parent,
        config,
        idempotencyKey,
        title: name,
        background: false,
        labels: { "swarm/work": work, "swarm/role": role, "swarm/member": name },
        prompt: `Your assignment from your parent:\n${brief}\n\nRead the swarm board at the start of the turn. Use your native parent session if a board tool is unavailable.`,
      });
      return { structuredContent: { agentId: child.id, name, role, provider: config.provider } };
    },
  });
}

export function instructionsFor(role: keyof typeof rolePrompt) {
  return `${rolePrompt[role]} ${assignmentScope}`;
}

export function reportTool(agentId: string, labels: Readonly<Record<string, string>>, board: ReturnType<typeof openSwarmBoard>) {
  return defineAgentTool({
    name: "report_swarm_result",
    description: "Raise a blocking human decision with a question, impact, and choices. Mark it decision-resolved once the user answers. Report the final verified result. Use the board for regular progress.",
    input: z.object({ status: z.enum(["verified", "needs-user", "decision-resolved", "incomplete"]), summary: z.string().trim().min(1).max(3000) }),
    async execute({ status, summary }, { agent, paseo }) {
      if (agent.id !== agentId) throw new Error("This tool belongs to a different session.");
      if (status === "needs-user") board.setDecision(agentId, summary);
      if (status === "verified" || status === "decision-resolved") board.setDecision(agentId);
      if (status === "decision-resolved") return { text: "Decision cleared from the human inbox." };
      const lead = paseo.agents.ref(agentId);
      const parent = getParentAddressFromLabels(labels, lead.address.serverId);
      if (!parent || parent.serverId !== lead.address.serverId) {
        return { text: "The originating chat is unavailable. The board retains any pending decision." };
      }
      try {
        await paseo.agents.ref(parent.agentId).send(
          `Swarm lead report (${status})\n\n${summary}\n\nPresent this result or question to the user. This is a teammate update.`,
          { sourceAgentId: agentId, sourceAgentServerId: lead.address.serverId, activeTurnBehavior: "queue" },
        );
      } catch (error) {
        if (status !== "needs-user") throw error;
        return { text: "Decision saved in the inbox. Paseo could not alert the originating chat." };
      }
      return { text: "Report sent to the originating chat." };
    },
  });
}
