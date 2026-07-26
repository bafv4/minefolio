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
import { sendFeedbackEmail } from "@/lib/email.server";
import { feedbackSchema } from "@/lib/feedback-schema";
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
import { toast } from "sonner";
import { Loader2, MessageSquare, Send, CheckCircle2 } from "lucide-react";
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

  return { user, appUrl: env.APP_URL || "https://minefolio.app" };
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

  const result = feedbackSchema.safeParse(rawData);
  if (!result.success) {
    return {
      error: result.error.issues[0].message,
    };
  }

  const { subject, message, category } = result.data;

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
    });

    return { success: true };
  } catch (error) {
    console.error("Feedback email error:", error);
    return { error: t("feedback.sendFailed") };
  }
}

export default function FeedbackPage() {
  const t = useT();
  const fetcher = useFetcher<typeof action>();
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [category, setCategory] = useState("other");
  const [sent, setSent] = useState(false);
  const prevDataRef = useRef(fetcher.data);

  const isSubmitting = fetcher.state === "submitting";

  useEffect(() => {
    const data = fetcher.data;
    if (!data || data === prevDataRef.current) return;
    prevDataRef.current = data;

    if ("success" in data && data.success) {
      toast.success(t("feedback.sentToast"));
      setSent(true);
      setSubject("");
      setMessage("");
      setCategory("other");
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
    fetcher.submit(formData, { method: "post" });
  };

  if (sent) {
    return (
      <div className="container mx-auto px-4 py-8 max-w-2xl">
        <Card>
          <CardContent>
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <CheckCircle2 className="h-16 w-16 text-green-500 mb-4" />
              <h2 className="text-xl font-semibold mb-2">
                {t("feedback.sentTitle")}
              </h2>
              <p className="text-muted-foreground mb-6">
                {t("feedback.sentDescription")}
              </p>
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
    <div className="container mx-auto px-4 py-8 max-w-2xl">
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
