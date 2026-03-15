import {
  redirect,
  useActionData,
  Form,
  type LoaderFunctionArgs,
  type ActionFunctionArgs,
} from "react-router";
import { createDb } from "@/lib/db";
import { createAuth } from "@/lib/auth";
import { getSession } from "@/lib/session";
import { getEnv } from "@/lib/env.server";
import { users, guides } from "@/lib/schema";
import { eq, and } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { t } from "@/lib/messages";

function titleToSlug(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .trim()
    .slice(0, 100);
  return slug || `guide-${createId().slice(0, 6)}`;
}

export const meta = () => [{ title: t("meGuides.newTitle") }];

export async function loader({ context, request }: LoaderFunctionArgs) {
  const env = context.env ?? getEnv();
  const db = createDb();
  const auth = createAuth(db, env);
  await getSession(request, auth);
  return null;
}

export async function action({ context, request }: ActionFunctionArgs) {
  const env = context.env ?? getEnv();
  const db = createDb();
  const auth = createAuth(db, env);
  const session = await getSession(request, auth);

  const user = await db.query.users.findFirst({
    where: eq(users.discordId, session.user.id),
  });
  if (!user) return redirect("/onboarding");

  const formData = await request.formData();
  const title = (formData.get("title") as string)?.trim();

  if (!title) {
    return { error: t("meGuides.errorTitleRequired") };
  }
  if (title.length > 200) {
    return { error: t("meGuides.errorTitleTooLong") };
  }

  // Count check
  const userGuides = await db.query.guides.findMany({
    where: eq(guides.authorId, user.id),
    columns: { id: true },
  });
  if (userGuides.length >= 100) {
    return { error: t("meGuides.errorLimitReached") };
  }

  // Generate unique slug
  let slug = titleToSlug(title);
  const existing = await db.query.guides.findFirst({
    where: and(eq(guides.authorId, user.id), eq(guides.slug, slug)),
    columns: { id: true },
  });
  if (existing) {
    slug = `${slug}-${createId().slice(0, 6)}`;
  }

  const [newGuide] = await db
    .insert(guides)
    .values({
      authorId: user.id,
      slug,
      title,
      content: `<h1>${title}</h1><p></p>`,
      isPublished: false,
      tags: "[]",
      viewCount: 0,
    })
    .returning();

  return redirect(`/me/guides/${newGuide.id}/edit`);
}

export default function NewGuidePage() {
  const actionData = useActionData<typeof action>();

  return (
    <div className="max-w-lg mx-auto">
      <Card>
        <CardHeader>
          <CardTitle>{t("meGuides.newTitle")}</CardTitle>
          <CardDescription>{t("meGuides.newDesc")}</CardDescription>
        </CardHeader>
        <CardContent>
          <Form method="post" className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="title">{t("meGuides.titleLabel")}</Label>
              <Input
                id="title"
                name="title"
                placeholder={t("meGuides.titlePlaceholder")}
                required
                autoFocus
                maxLength={200}
              />
            </div>
            {actionData && "error" in actionData && (
              <p className="text-sm text-destructive">{actionData.error}</p>
            )}
            <Button type="submit" className="w-full">
              {t("meGuides.createAndEdit")}
            </Button>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
