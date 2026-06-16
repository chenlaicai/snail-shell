import { z } from "zod";

export const WorkspaceSummaryDtoSchema = z.object({ id: z.string(), path: z.string(), summary: z.string().nullable() }).passthrough();
export const IssueDetailDtoSchema = z.object({ id: z.string(), title: z.string(), stages: z.array(z.unknown()), current_stage: z.unknown().nullable() }).passthrough();
export const MessageDtoSchema = z.object({ id: z.number(), stage_id: z.string(), status: z.string() }).passthrough();
