import type { PluginServerContext } from "@getpaseo/plugin/server";
import { homedir } from "node:os";
import { join } from "node:path";
import { openSwarmBoard } from "./server/board.ts";
import { instructionsFor, launchTool, readModels, reportTool, startLead } from "./server/launch.ts";
import { readNativeApprovals } from "./server/inbox.ts";
import { readInbox } from "./shared/inbox.ts";
import { readBoard } from "./shared/board.ts";
import { startSwarm } from "./shared/launch.ts";

export default function contribute(server: PluginServerContext) {
  const home = process.env.PASEO_HOME || join(homedir(), ".paseo");
  const data = join(home, "plugin-data", "paseo-swarm-board");
  const models = join(data, "models.json");
  const board = openSwarmBoard(join(data, "board.json"));

  server.handle(readBoard, ({ id }) => board.view(id));
  server.handle(readInbox, async (_, { paseo }) => [
    ...await readNativeApprovals(paseo),
    ...board.decisions(),
  ]);
  server.handle(startSwarm, ({ sourceAgentId, brief, stage }, { paseo }) => startLead(paseo, sourceAgentId, brief, readModels(models), stage));

  const removeOpen = server.addHook("agent.open.before", async ({ request }, { paseo }) => {
    const work = request.labels["swarm/work"];
    if (!work || request.labels["swarm/member"] === undefined || request.background || request.purpose !== "interactive") return;
    const member = board.attach(request, work, paseo);
    const planning = member.stage === "planning";
    const canDelegate = member.role === "lead" || member.role === "specialist";
    return {
      ...request,
      tools: [
        ...request.tools,
        ...(planning ? [] : member.tools),
        ...(!planning && canDelegate ? [launchTool(member, request.agentId, work, board, models)] : []),
        ...(member.role === "lead" ? [reportTool(request.agentId, request.labels, board)] : []),
      ],
      appendSystemPrompt: [
        ...(request.appendSystemPrompt ?? []),
        ...(planning ? [] : [member.instructions, instructionsFor(member.role)]),
      ],
    };
  });

  const removeArchive = server.addHook("agent.archive.after", async ({ agent }) => {
    if (board.get(agent.id)?.decision) board.setDecision(agent.id);
  });

  return () => { removeOpen(); removeArchive(); };
}
