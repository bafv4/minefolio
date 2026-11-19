import { createTranslator } from "@/lib/messages";
import { localeFromMatches, resolveLocale } from "@/lib/locale";
import { useState, useEffect, useRef } from "react";
import { useFetcher } from "react-router";
import type { Route } from "./+types/feedback";
import { createDb } from "@/lib/db";
import { createAuth } from "@/lib/auth";
import { getSession } from "@/lib/session";
import { getEnv } from "@/lib/env.server";
import { users } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { sendFeedbackEmail, categoryLabels } from "@/lib/email.server";
import { createFeedbackSchema, FEEDBACK_BODY_MIN, FEEDBACK_SUBJECT_MIN } from "@/lib/feedback-schema";
import { createFeedbackIssue } from "@/lib/github.server";
import { cn } from "@/lib/utils";
import { createId } from "@paralleldrive/cuid2";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { NoticeBanner } from "@/components/notice-banner";
import { toast } from "sonner";
import {
  AlertCircle,
  Loader2,
  MessageSquare,
  Send,
  CheckCircle2,
  ExternalLink,
} from "lucide-react";
import { useT } from "@/hooks/use-locale";

export const meta: Route.MetaFunction = ({ matches, loaderData }) => {
  const t = createTranslator(localeFromMatches(matches));
  const title = t("feedback.title");
  const description = t("feedback.metaDescription");
  const appUrl = loaderData?.appUrl || "https://minefolio.app";
  const ogImage = `${appUrl}/icon.png`;
  return [
    { title },
    { name: "description", content: description },
    { property: "og:type", content: "website" },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
    { property: "og:image", content: ogImage },
    { name: "twitter:card", content: "summary" },
    { name: "twitter:title", content: title },
    { name: "twitter:description", content: description },
    { name: "twitter:image", content: ogImage },
  ];
};

export async function loader({ request }: Route.LoaderArgs) {
  const t = createTranslator(resolveLocale(request));
  const env = getEnv();
  const db = createDb();
  const auth = createAuth(db, env);

  const session = await getSession(request, auth);

  const user = await db.query.users.findFirst({
    where: eq(users.discordId, session.user.id),
  });

  if (!user) {
    throw new Response(t("feedback.userNotFound"), { status: 404 });
  }

  return {
    user,
    appUrl: env.APP_URL || "https://minefolio.app",
    // GITHUB_FEEDBACK_TOKEN 未設定環境ではIssue化オプトインのチェックボックス自体を出さない
    canCreateIssue: Boolean(env.GITHUB_FEEDBACK_TOKEN),
  };
}

export async function action({ request }: Route.ActionArgs) {
  const t = createTranslator(resolveLocale(request));
  const env = getEnv();
  const db = createDb();
  const auth = createAuth(db, env);

  const session = await getSession(request, auth);

  const user = await db.query.users.findFirst({
    where: eq(users.discordId, session.user.id),
  });

  if (!user) {
    return { error: t("feedback.userNotFound") };
  }

  if (!env.FEEDBACK_EMAIL || !env.RESEND_API_KEY) {
    console.error("Feedback email or Resend API key not configured");
    return { error: t("feedback.notConfigured") };
  }

  const formData = await request.formData();
  const rawData = {
    subject: formData.get("subject") as string,
    message: formData.get("message") as string,
    category: formData.get("category") as string,
  };

  const result = createFeedbackSchema(t).safeParse(rawData);
  if (!result.success) {
    const issue = result.error.issues[0];
    // 欄に結ぶため、どの欄のエラーかも返す（カテゴリ・件名・本文）
    const path = issue.path[0];
    return {
      error: issue.message,
      field: path === "category" || path === "subject" || path === "message" ? path : null,
    };
  }

  const { subject, message, category } = result.data;

  // メールとIssueの両方に入れる相関ID。送信者の特定はメール側（Discord ID等）でのみ可能にするため、
  // Issue本文にはこのIDだけを載せ、個人情報は一切含めない。
  const feedbackId = createId().slice(0, 8);

  // メール送信（主経路）を必ず先に行う。Issue作成を先にすると、Issue成功→メール失敗のときに
  // 突き合わせ先のメールが存在しない公開Issueが残り、ユーザーの再送信で重複Issueも生まれるため。
  try {
    await sendFeedbackEmail({
      to: env.FEEDBACK_EMAIL,
      subject: `[Minefolio Feedback] ${subject}`,
      discordId: session.user.id,
      mcid: user.mcid,
      displayName: user.displayName,
      category,
      message,
      resendApiKey: env.RESEND_API_KEY,
      feedbackId,
    });
  } catch (error) {
    console.error("Feedback email error:", error);
    return { error: t("feedback.sendFailed") };
  }

  let issueUrl: string | undefined;
  let issueCreateFailed = false;

  const createIssueRequested = formData.get("createIssue") === "true";
  const githubToken = env.GITHUB_FEEDBACK_TOKEN;

  if (createIssueRequested && githubToken) {
    const labels = ["feedback"];
    if (category === "bug") labels.push("bug");
    if (category === "feature") labels.push("enhancement");

    const issueBody = [
      `カテゴリ: ${categoryLabels[category] ?? categoryLabels.other}`,
      "",
      message,
      "",
      "---",
      `Feedback-ID: ${feedbackId}`,
    ].join("\n");

    try {
      const issue = await createFeedbackIssue({
        token: githubToken,
        repo: env.GITHUB_FEEDBACK_REPO || "bafv4/minefolio",
        title: subject,
        body: issueBody,
        labels,
      });
      issueUrl = issue.url;
    } catch (error) {
      console.error("Feedback GitHub Issue creation error:", error);
      issueCreateFailed = true;
    }
  }

  return { success: true, issueUrl, issueCreateFailed };
}

export default function FeedbackPage({ loaderData }: Route.ComponentProps) {
  const t = useT();
  const { canCreateIssue } = loaderData;
  const fetcher = useFetcher<typeof action>();
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [category, setCategory] = useState("");
  const [createIssue, setCreateIssue] = useState(false);
  const [sent, setSent] = useState(false);
  const [issueUrl, setIssueUrl] = useState<string | null>(null);
  // 欄に結ぶエラー（件名・本文）。欄を書き直したら消す
  const [fieldErrors, setFieldErrors] = useState<{
    category: string | null;
    subject: string | null;
    message: string | null;
  }>({
    category: null,
    subject: null,
    message: null,
  });
  const categoryRef = useRef<HTMLButtonElement>(null);
  const subjectRef = useRef<HTMLInputElement>(null);
  const messageRef = useRef<HTMLTextAreaElement>(null);
  const prevDataRef = useRef(fetcher.data);

  const isSubmitting = fetcher.state === "submitting";

  useEffect(() => {
    const data = fetcher.data;
    if (!data || data === prevDataRef.current) return;
    prevDataRef.current = data;

    if ("success" in data && data.success) {
      toast.success(t("feedback.sentToast"));
      if (data.issueCreateFailed) {
        toast.error(t("feedback.issueCreateFailedToast"));
      }
      setSent(true);
      setIssueUrl(data.issueUrl ?? null);
      setSubject("");
      setMessage("");
      setCategory("");
      setCreateIssue(false);
      setFieldErrors({ category: null, subject: null, message: null });
    } else if ("error" in data) {
      const field = "field" in data ? data.field : null;
      if (field) {
        // 欄のエラーは欄の下に出し、その欄へフォーカスを戻す（トーストは出さない）
        setFieldErrors((prev) => ({ ...prev, [field]: data.error }));
        (field === "category" ? categoryRef : field === "subject" ? subjectRef : messageRef).current?.focus();
      } else {
        toast.error(data.error);
      }
    }
  }, [fetcher.data]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // カテゴリは未選択が既定なので、送る前に選ばせる（サーバーも同じ検証をする）
    if (!category) {
      setFieldErrors((prev) => ({ ...prev, category: t("feedback.categoryRequired") }));
      categoryRef.current?.focus();
      return;
    }
    const formData = new FormData();
    formData.set("subject", subject);
    formData.set("message", message);
    formData.set("category", category);
    formData.set("createIssue", createIssue ? "true" : "false");
    fetcher.submit(formData, { method: "post" });
  };

  if (sent) {
    return (
      <div className="max-w-2xl mx-auto w-full">
        <Card>
          <CardContent>
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <CheckCircle2 className="h-16 w-16 text-success mb-4" aria-hidden />
              <h1 className="text-2xl font-bold mb-2">
                {t("feedback.sentTitle")}
              </h1>
              <p className={cn("text-muted-foreground", issueUrl ? "mb-3" : "mb-6")}>
                {t("feedback.sentDescription")}
              </p>
              {issueUrl && (
                <a
                  href={issueUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mb-6 inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
                >
                  <ExternalLink className="h-4 w-4" />
                  {t("feedback.viewIssue")}
                </a>
              )}
              <Button onClick={() => setSent(false)} variant="outline" className="min-h-11 sm:min-h-9">
                {t("feedback.sendAnother")}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto w-full">
      <Card>
        <CardHeader>
          {/* ページの h1。見た目は CardTitle と同じ */}
          <h1 data-slot="card-title" className="flex items-center gap-2 text-2xl leading-snug font-bold">
            <MessageSquare className="h-5 w-5" aria-hidden />
            {t("feedback.pageTitle")}
          </h1>
          <CardDescription>
            {t("feedback.pageDescription")}
          </CardDescription>
          {/* 送った内容の行き先（privacy.md「2. 4.」「4.」の Resend の行・terms.md「12.」に書いてあることだけ） */}
          <CardDescription>
            {t("feedback.deliveryNote")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="category">{t("feedback.category")}</Label>
              <Select
                value={category}
                onValueChange={(value) => {
                  setCategory(value);
                  if (fieldErrors.category) setFieldErrors((prev) => ({ ...prev, category: null }));
                }}
              >
                <SelectTrigger
                  ref={categoryRef}
                  id="category"
                  aria-required
                  aria-invalid={fieldErrors.category ? true : undefined}
                  aria-describedby={fieldErrors.category ? "category-error" : undefined}
                >
                  <SelectValue placeholder={t("feedback.categoryPlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="bug">{t("feedback.categoryBug")}</SelectItem>
                  <SelectItem value="feature">{t("feedback.categoryFeature")}</SelectItem>
                  <SelectItem value="other">{t("feedback.categoryOther")}</SelectItem>
                </SelectContent>
              </Select>
              <FieldError id="category-error" message={fieldErrors.category} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="subject">{t("feedback.subject")}</Label>
              <Input
                ref={subjectRef}
                id="subject"
                value={subject}
                onChange={(e) => {
                  setSubject(e.target.value);
                  if (fieldErrors.subject) setFieldErrors((prev) => ({ ...prev, subject: null }));
                }}
                onBlur={() => {
                  // 入力があるのに短いときだけ、送信時と同じ基準（feedback-schema の min）で知らせる
                  if (subject.length > 0 && subject.length < FEEDBACK_SUBJECT_MIN) {
                    setFieldErrors((prev) => ({ ...prev, subject: t("feedback.subjectTooShort") }));
                  }
                }}
                placeholder={t("feedback.subjectPlaceholder")}
                maxLength={100}
                required
                aria-invalid={fieldErrors.subject ? true : undefined}
                aria-describedby={fieldErrors.subject ? "subject-error subject-hint" : "subject-hint"}
              />
              <FieldError id="subject-error" message={fieldErrors.subject} />
              <p id="subject-hint" className="text-xs text-muted-foreground">
                {t("feedback.subjectHint")}
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="message">{t("feedback.message")}</Label>
              {/* 基底の field-sizing-content（中身に合わせて伸縮）だと空のとき約2行になり rows が効かないので、
                  ここだけ固定にして rows={8} の高さを出す */}
              <Textarea
                ref={messageRef}
                id="message"
                value={message}
                onChange={(e) => {
                  setMessage(e.target.value);
                  if (fieldErrors.message) setFieldErrors((prev) => ({ ...prev, message: null }));
                }}
                onBlur={() => {
                  if (message.length > 0 && message.length < FEEDBACK_BODY_MIN) {
                    setFieldErrors((prev) => ({ ...prev, message: t("feedback.bodyTooShort") }));
                  }
                }}
                placeholder={t("feedback.messagePlaceholder")}
                rows={8}
                maxLength={2000}
                required
                className="field-sizing-fixed"
                aria-invalid={fieldErrors.message ? true : undefined}
                aria-describedby={fieldErrors.message ? "message-error message-hint" : "message-hint"}
              />
              <FieldError id="message-error" message={fieldErrors.message} />
              <p id="message-hint" className="text-xs text-muted-foreground">
                {t("feedback.messageHint", { count: message.length })}
              </p>
            </div>

            {canCreateIssue && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="createIssue"
                    checked={createIssue}
                    onCheckedChange={(checked) => setCreateIssue(checked === true)}
                  />
                  <Label htmlFor="createIssue" className="font-normal">
                    {t("feedback.createIssueLabel")}
                  </Label>
                </div>
                <p className="text-xs text-muted-foreground">
                  {t("feedback.createIssueHint1")}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t("feedback.createIssueHint2")}
                </p>
              </div>
            )}

            {/* 欄に結ばないエラー（送信の失敗など）だけ、ここに出す */}
            {fetcher.data && "error" in fetcher.data && !("field" in fetcher.data && fetcher.data.field) && (
              <NoticeBanner tone="error" icon={AlertCircle}>
                {fetcher.data.error}
              </NoticeBanner>
            )}

            <Button type="submit" disabled={isSubmitting} className="w-full min-h-11 sm:min-h-9">
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t("feedback.sending")}
                </>
              ) : (
                <>
                  <Send className="mr-2 h-4 w-4" />
                  {t("feedback.submit")}
                </>
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

/** 欄の直下に出すエラー（入力欄の aria-describedby から id で結ぶ） */
function FieldError({ id, message }: { id: string; message: string | null }) {
  if (!message) return null;
  return (
    <p id={id} className="flex items-start gap-1 text-xs text-destructive">
      <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
      {message}
    </p>
  );
}
