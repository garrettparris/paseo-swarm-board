import type { PaseoApi } from "@getpaseo/client";
import type { InboxItem } from "../shared/inbox.ts";

export async function readNativeApprovals(paseo: PaseoApi) {
  const approvals = new Map<string, InboxItem>();
  const cursors = new Set<string>();
  let cursor: string | undefined;
  do {
    const page = await paseo.agents.list({
      scope: "active",
      filter: { includeArchived: false, includeBackground: false },
      page: { limit: 100, cursor },
    });
    for (const { agent } of page.entries) {
      if (agent.archivedAt || agent.background || !agent.pendingPermissions.length) continue;
      approvals.set(agent.id, {
        agentId: agent.id,
        title: agent.title || "Paseo session",
        request: { kind: "approval", count: agent.pendingPermissions.length },
      });
    }
    cursor = page.pageInfo.nextCursor ?? undefined;
    if (cursor) {
      if (cursors.has(cursor)) throw new Error("Paseo repeated an approvals page. Try refreshing.");
      cursors.add(cursor);
    }
  } while (cursor);
  return [...approvals.values()];
}
