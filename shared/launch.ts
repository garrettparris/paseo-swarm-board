import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import { swarmRole, swarmStage } from "./board.ts";

export const modelConfig = z.strictObject({
  provider: z.string().trim().regex(/^[^/\s]+\/\S+$/),
  thinkingOptionId: z.string().min(1).optional(),
  modeId: z.string().min(1).optional(),
  options: z.record(z.string(), z.json()).optional(),
});

export const roleModels = z.partialRecord(swarmRole, modelConfig);
export const briefText = z.string().trim().min(1).max(15000);

export const startSwarm = defineRpc({
  name: "swarm.start",
  input: z.object({ sourceAgentId: z.string().min(1), brief: briefText, stage: swarmStage.optional() }),
  output: z.object({ leadId: z.string().min(1) }),
});
