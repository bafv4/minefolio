import { z } from "zod/v4";

export const feedbackSchema = z.object({
  subject: z
    .string()
    .min(1, "件名を入力してください")
    .min(5, "件名は5文字以上で入力してください")
    .max(100, "件名は100文字以下で入力してください"),
  message: z
    .string()
    .min(1, "本文を入力してください")
    .min(10, "本文は10文字以上で入力してください")
    .max(2000, "本文は2000文字以下で入力してください"),
  category: z.enum(["bug", "feature", "other"]).optional().default("other"),
});

export type FeedbackFormData = z.infer<typeof feedbackSchema>;
