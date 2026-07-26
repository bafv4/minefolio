import { z } from "zod/v4";
import type { Translator } from "@/lib/messages";

/**
 * バリデーションメッセージはロケール依存のため、スキーマは呼び出し側で組み立てる。
 * サーバー（action）では createTranslator(resolveLocale(request)) を渡すこと。
 */
export function createFeedbackSchema(t: Translator) {
  return z.object({
    subject: z
      .string()
      .min(1, t("feedback.subjectRequired"))
      .min(5, t("feedback.subjectTooShort"))
      .max(100, t("feedback.subjectTooLong")),
    message: z
      .string()
      .min(1, t("feedback.bodyRequired"))
      .min(10, t("feedback.bodyTooShort"))
      .max(2000, t("feedback.bodyTooLong")),
    category: z.enum(["bug", "feature", "other"]).optional().default("other"),
  });
}

export type FeedbackFormData = z.infer<ReturnType<typeof createFeedbackSchema>>;
