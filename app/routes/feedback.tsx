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
import { createFeedbackSchema } from "@/lib/feedback-schema";
import { createFeedbackIssue } from "@/lib/github.server";
import { cn } from "@/lib/utils";
import { createId } from "@paralleldrive/cuid2";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
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
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import {
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
    category: (formData.get("category") as string) || "other",
  };

  const result = createFeedbackSchema(t).safeParse(rawData);
  if (!result.success) {
    return {
      error: result.error.issues[0].message,
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
  const [category, setCategory] = useState("other");
  const [createIssue, setCreateIssue] = useState(false);
  const [sent, setSent] = useState(false);
  const [issueUrl, setIssueUrl] = useState<string | null>(null);
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
      setCategory("other");
      setCreateIssue(false);
    } else if ("error" in data) {
      toast.error(data.error);
    }
  }, [fetcher.data]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
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
              <CheckCircle2 className="h-16 w-16 text-success mb-4" />
              <h2 className="text-xl font-semibold mb-2">
                {t("feedback.sentTitle")}
              </h2>
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
              <Button onClick={() => setSent(false)} variant="outline">
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
          <CardTitle className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5" />
            {t("feedback.pageTitle")}
          </CardTitle>
          <CardDescription>
            {t("feedback.pageDescription")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="category">{t("feedback.category")}</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger id="category">
                  <SelectValue placeholder={t("feedback.categoryPlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="bug">{t("feedback.categoryBug")}</SelectItem>
                  <SelectItem value="feature">{t("feedback.categoryFeature")}</SelectItem>
                  <SelectItem value="other">{t("feedback.categoryOther")}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="subject">{t("feedback.subject")}</Label>
              <Input
                id="subject"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder={t("feedback.subjectPlaceholder")}
                maxLength={100}
                required
              />
              <p className="text-xs text-muted-foreground">
                {t("feedback.subjectHint")}
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="message">{t("feedback.message")}</Label>
              <Textarea
                id="message"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder={t("feedback.messagePlaceholder")}
                rows={8}
                maxLength={2000}
                required
              />
              <p className="text-xs text-muted-foreground">
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

            {fetcher.data && "error" in fetcher.data && (
              <Alert variant="destructive">
                <AlertDescription>{fetcher.data.error}</AlertDescription>
              </Alert>
            )}

            <Button type="submit" disabled={isSubmitting} className="w-full">
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
