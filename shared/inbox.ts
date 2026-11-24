import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import { boardRun, humanDecision } from "./board.ts";

export const inboxItem = z.object({
  agentId: z.string().min(1),
  title: z.string(),
  request: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("approval"), count: z.number().int().positive() }),
    humanDecision.extend({ kind: z.literal("decision"), issue: boardRun.shape.issue }),
  ]),
});
export type InboxItem = z.infer<typeof inboxItem>;

export const readInbox = defineRpc({
  name: "swarm.inbox",
  input: z.object({}),
  output: z.array(inboxItem),
});
