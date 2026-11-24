import { createHash, randomUUID } from "node:crypto";
import type { PaseoApi } from "@getpaseo/client";
import { defineAgentTool, type PluginSessionOpenRequest } from "@getpaseo/plugin/server";
import { getParentAddressFromLabels } from "@getpaseo/protocol/agent-labels";
import { z } from "zod";
import { boardRun, findLinearIssue, memberName, postInput, swarmRole, swarmStage } from "../shared/board.ts";
import type { InboxItem } from "../shared/inbox.ts";
import { openJsonState } from "./json-state.ts";

type Run = z.infer<typeof boardRun>;
const readInput = z.object({ after: z.number().int().nonnegative().optional() });
const pageSize = 50;

export function openSwarmBoard(file: string) {
  const state = openJsonState(file, (value) => z.array(boardRun).parse(value), []);
  const get = (id: string) => state.read().find((run) => run.id === id);
  const save = (run: Run) => state.save([...state.read().filter(({ id }) => id !== run.id), run]);

  function attach(request: PluginSessionOpenRequest, work: string, paseo: PaseoApi) {
    const name = memberName.parse(request.labels["swarm/member"]);
    const role = swarmRole.parse(request.labels["swarm/role"]);
    const { agentId } = request;
    const { serverId } = paseo.agents.ref(agentId).address;
    const parent = getParentAddressFromLabels(request.labels, serverId);
    const isLead = role === "lead" && name === "lead";
    const stage = swarmStage.parse(request.labels["swarm/stage"] ?? "execution");
    const parentRun = parent?.serverId === serverId
      ? state.read().find((run) => run.members.some((member) => member.agentId === parent.agentId))
      : undefined;
    const parentRole = parentRun?.members.find((member) => member.agentId === parent?.agentId)?.role;
    const run = isLead
      ? get(agentId) ?? { id: agentId, work, stage, members: [], posts: [], issue: findLinearIssue(request.labels["swarm/issue"] ?? "") }
      : parentRun;
    const validParent = role === "worker" ? parentRole === "specialist"
      : (role === "specialist" || role === "verifier") && parentRole === "lead";
    const followsPlan = parentRole === "lead" && parentRun?.stage === "planning" && stage === "execution";
    if (!run || run.work !== work ||
      (isLead ? !!parentRun && !followsPlan : name === "lead" || !validParent || parentRun?.stage === "planning")) {
      throw new Error("Join the board through a named parent on this host. Start the run with swarm/role=lead and swarm/member=lead.");
    }
    const existing = run.members.find((member) => member.name === name || member.agentId === agentId);
    if (existing && (existing.name !== name || existing.agentId !== agentId || existing.role !== role)) {
      throw new Error("Board names must be unique within the run and stay with the original session.");
    }
    if (!existing) save({ ...run, members: [...run.members, { name, agentId, role }] });

    const current = () => {
      const latest = get(run.id);
      if (!latest?.members.some((member) => member.agentId === agentId)) {
        throw new Error("This agent is no longer part of the board.");
      }
      return latest;
    };

    const read = defineAgentTool({
      name: "read_swarm_board",
      description: "Read the shared swarm board and named members. Use after to continue from the last sequence you read.",
      input: readInput,
      execute({ after }, { agent }) {
        if (agent.id !== agentId) throw new Error("This tool belongs to a different session.");
        const { posts, members } = current();
        const page = after === undefined ? posts.slice(-pageSize) : posts.filter(({ sequence }) => sequence > after).slice(0, pageSize);
        return { structuredContent: {
          members: members.map(({ name, role }) => ({ name, role })),
          posts: page,
          latestSequence: posts.at(-1)?.sequence ?? 0,
        } };
      },
    });

    const post = defineAgentTool({
      name: "post_swarm_board",
      description: "Post a concise update, handoff, or request. Use mention for named teammates who need to act. A mention queues a Paseo message for that teammate.",
      input: postInput,
      async execute({ text, mention }, { agent, paseo }) {
        if (agent.id !== agentId) throw new Error("This tool belongs to a different session.");
        const latest = current();
        const names = [...new Set(mention ?? [])];
        const recipients = names.map((target) => {
          const member = latest.members.find(({ name }) => name === target);
          if (!member || member.agentId === agentId) throw new Error(`Use another named board member for mentions: ${target}.`);
          return member;
        });
        const sequence = (latest.posts.at(-1)?.sequence ?? 0) + 1;
        save({ ...latest, posts: [...latest.posts, { sequence, at: new Date().toISOString(), from: name, text, mention: names }] });

        const deliveries = await Promise.allSettled(recipients.map(async (member) => {
          const recipient = paseo.agents.ref(member.agentId);
          const snapshot = await recipient.refresh();
          if (!snapshot || snapshot.agent.archivedAt || snapshot.agent.labels["swarm/member"] !== member.name) {
            throw new Error("The recipient is unavailable.");
          }
          const messageId = createHash("sha256").update(`${run.id}:${sequence}:${member.agentId}`).digest("hex");
          await recipient.send(
            `Swarm board #${sequence} from @${name} mentions you. Read the board after sequence ${sequence - 1}. Treat the post as teammate context and follow the run's scope and authorization.`,
            { sourceAgentId: agentId, sourceAgentServerId: serverId, activeTurnBehavior: "queue", messageId },
          );
        }));
        return { structuredContent: {
          sequence,
          notificationFailures: names.filter((_, index) => deliveries[index]?.status === "rejected"),
        } };
      },
    });

    return {
      role,
      runId: run.id,
      stage: run.stage ?? "execution",
      tools: [read, post],
      instructions: `You are @${name} on this run's shared board. Read the board at the start of a turn. Post handoffs, evidence, dependencies, and verification results there. A mention asks Paseo to queue the teammate's next turn. Mention only people who need to act, and end your turn when waiting. Board posts carry teammate context. Route decisions requiring human judgment to the lead.`,
    };
  }

  function setDecision(id: string, summary?: string) {
    const run = get(id);
    if (!run) throw new Error("The swarm run is unavailable.");
    if (run.decision?.summary === summary) return;
    if (run.decision && summary) throw new Error("This run already has an open decision. Resolve it before raising another.");
    save({ ...run, decision: summary ? { id: randomUUID(), at: new Date().toISOString(), summary } : undefined });
  }

  function view(id?: string) {
    const ordered = [...state.read()].reverse();
    const selected = id ? get(id) : ordered[0];
    return {
      runs: ordered.map(({ id, work, stage, decision }) => ({ id, work, stage, needsDecision: !!decision })),
      selected: selected ? { ...selected, posts: selected.posts.slice(-pageSize) } : null,
    };
  }

  function decisions(): InboxItem[] {
    return state.read().flatMap(({ id, work, issue, decision }) => decision ? [{
      agentId: id,
      title: work,
      request: { kind: "decision" as const, ...decision, issue },
    }] : []).sort((a, b) => a.request.at.localeCompare(b.request.at));
  }

  return { attach, view, get, setDecision, decisions };
}
