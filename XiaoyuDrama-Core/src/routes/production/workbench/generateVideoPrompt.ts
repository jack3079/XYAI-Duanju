import express from "express";
import { z } from "zod";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { prepareVideoPromptContext, type VideoPromptTaskInput } from "@/utils/workbenchVideoPrompt";
import { claimVideoPromptTracks, runClaimedVideoPrompt } from "@/utils/workbenchVideoPromptClaim";

const router = express.Router();
const modeSchema = z.union([z.string().trim().min(1), z.array(z.string().trim().min(1)).min(1)]);

export default router.post(
  "/",
  validateFields({
    trackId: z.number().int().positive(),
    projectId: z.number().int().positive(),
    info: z.array(z.object({
      id: z.number().int().positive(),
      sources: z.enum(["assets", "storyboard"]),
      fileType: z.enum(["image", "video", "audio"]).optional(),
    })).max(64),
    model: z.string().trim().min(3),
    mode: modeSchema,
  }),
  async (req, res) => {
    const input = req.body as VideoPromptTaskInput;
    try {
      const context = await prepareVideoPromptContext(input.projectId, input.model, input.mode);
      await claimVideoPromptTracks([input]);
      const text = await runClaimedVideoPrompt(input, context);
      res.status(200).send(success(text));
    } catch (exception) {
      const status = Number((exception as any)?.status || 502);
      const safeStatus = status >= 400 && status <= 599 ? status : 502;
      res.status(safeStatus).send(error(exception instanceof Error ? exception.message : String(exception)));
    }
  },
);
