import type { PluginClientContext, PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { InboxItem, InboxScreen } from "./client/inbox-screen.tsx";
import { BoardScreen } from "./client/board-screen.tsx";
import { startSwarm } from "./shared/launch.ts";

function BoardItem({ currentScreen, openScreen }: PluginSidebarItemProps) {
  return <SidebarRow icon="Workflow" active={currentScreen?.screenId === "board"} onPress={() => openScreen({ screenId: "board" })} />;
}

export default function contribute(client: PluginClientContext) {
  const registrations = [
    client.addScreen({ id: "inbox", title: "Human Decisions", Component: InboxScreen }),
    client.addSidebarHeaderItem({ id: "inbox", title: "Human Decisions", Component: InboxItem }),
    client.addScreen({ id: "board", title: "Swarm Board", Component: BoardScreen }),
    client.addSidebarHeaderItem({ id: "board", title: "Swarm Board", Component: BoardItem }),
    client.addSlashCommand({
      name: "swarm",
      description: "Plan or start a swarm in this workspace",
      argumentHint: "[plan|run] <brief>",
      context: "agent",
      async onSubmit({ args, agent, rpc, openScreen }) {
        const [mode] = args.split(/\s+/, 1);
        const brief = (mode === "plan" || mode === "run" ? args.slice(mode.length) : args).trim();
        if (!brief) throw new Error("Enter a brief after /swarm. Use /swarm plan for planning only.");
        const stage = mode === "plan" ? "planning" : "execution";
        const { leadId } = await rpc(startSwarm, { sourceAgentId: agent.id, brief, stage });
        openScreen({ screenId: "board", params: { run: leadId } });
      },
    }),
  ];
  return () => registrations.forEach((cleanup) => cleanup());
}
