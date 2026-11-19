import { z } from "zod/v4";
import type { Translator } from "@/lib/messages";

/** 送信時の最小文字数。画面側の onBlur 検証も同じ値を参照する */
export const FEEDBACK_SUBJECT_MIN = 5;
export const FEEDBACK_BODY_MIN = 10;

/**
 * バリデーションメッセージはロケール依存のため、スキーマは呼び出し側で組み立てる。
 * サーバー（action）では createTranslator(resolveLocale(request)) を渡すこと。
 */
export function createFeedbackSchema(t: Translator) {
  return z.object({
    subject: z
      .string()
      .min(1, t("feedback.subjectRequired"))
      .min(FEEDBACK_SUBJECT_MIN, t("feedback.subjectTooShort"))
      .max(100, t("feedback.subjectTooLong")),
    message: z
      .string()
      .min(1, t("feedback.bodyRequired"))
      .min(FEEDBACK_BODY_MIN, t("feedback.bodyTooShort"))
      .max(2000, t("feedback.bodyTooLong")),
    // 未選択（空文字・欠落）はエラー。既定は「その他」にせず、選んでもらう
    category: z.enum(["bug", "feature", "other"], { error: t("feedback.categoryRequired") }),
  });
}

