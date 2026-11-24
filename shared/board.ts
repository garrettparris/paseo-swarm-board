import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const memberName = z.string().regex(/^[a-z][a-z0-9-]{0,31}$/);
const agentId = z.string().min(1);
export const swarmRole = z.enum(["lead", "specialist", "worker", "verifier"]);
const boardMember = z.object({ name: memberName, agentId, role: swarmRole });
const postText = z.string().trim().min(1).max(3000);
export const postInput = z.object({
  text: postText,
  mention: z.array(memberName).max(8).optional(),
});

export const boardPost = z.object({
  sequence: z.number().int().positive(),
  at: z.string(),
  from: memberName,
  text: postText,
  mention: z.array(memberName),
});

const linearIssue = z.object({
  url: z.string().url().startsWith("https://linear.app/"),
  identifier: z.string().regex(/^[A-Z][A-Z0-9]*-\d+$/),
});
export const humanDecision = z.object({
  id: z.uuid(),
  at: z.iso.datetime(),
  summary: z.string().min(1).max(3000),
});

export const swarmStage = z.enum(["planning", "execution"]);
export const boardRun = z.object({
  id: agentId,
  work: z.string().min(1),
  stage: swarmStage.optional(),
  members: z.array(boardMember),
  posts: z.array(boardPost),
  issue: linearIssue.optional(),
  decision: humanDecision.optional(),
});

export const readBoard = defineRpc({
  name: "swarm.board",
  input: z.object({ id: agentId.optional() }),
  output: z.object({
    runs: z.array(boardRun.pick({ id: true, work: true, stage: true }).extend({ needsDecision: z.boolean() })),
    selected: boardRun.nullable(),
  }),
});

export function findLinearIssue(text: string) {
  const match = text.match(/https:\/\/linear\.app\/([a-z0-9_-]+)\/issue\/([a-z][a-z0-9]*-\d+)(?:\/[a-z0-9_-]+)?(?=$|[\s)\]#?,.>"'])/i);
  return match ? { url: match[0], identifier: match[2].toUpperCase() } : undefined;
}
