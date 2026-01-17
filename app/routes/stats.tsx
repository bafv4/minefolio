import type { Route } from "./+types/stats";
import { useLoaderData } from "react-router";
import { createDb } from "@/lib/db";
import { users } from "@/lib/schema";
import { sql } from "drizzle-orm";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, Eye, BarChart3 } from "lucide-react";

export const meta: Route.MetaFunction = () => {
  return [
    { title: "統計 - Minefolio" },
    { name: "description", content: "Minefolioプラットフォームの統計情報。" },
  ];
};

export async function loader({ context }: Route.LoaderArgs) {
  const { env } = context.cloudflare;
  const db = createDb(env.DB);

  const [totalUsersResult, totalViewsResult] = await Promise.all([
    db.select({ count: sql<number>`count(*)` }).from(users),
    db.select({ sum: sql<number>`sum(profile_views)` }).from(users),
  ]);

  return {
    totalUsers: totalUsersResult[0]?.count ?? 0,
    totalViews: totalViewsResult[0]?.sum ?? 0,
  };
}

export default function StatsPage() {
  const { totalUsers, totalViews } = useLoaderData<typeof loader>();

  const stats = [
    {
      title: "総プレイヤー数",
      value: totalUsers.toLocaleString(),
      description: "登録スピードランナー",
      icon: Users,
    },
    {
      title: "総閲覧数",
      value: totalViews.toLocaleString(),
      description: "全プロフィールの合計",
      icon: Eye,
    },
  ];

  return (
    <div className="flex-1 flex flex-col space-y-6">
      <div>
        <h1 className="text-3xl font-bold">プラットフォーム統計</h1>
        <p className="text-muted-foreground mt-1">
          Minefolioの利用統計とメトリクス。
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat) => (
          <Card key={stat.title}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{stat.title}</CardTitle>
              <stat.icon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stat.value}</div>
              <p className="text-xs text-muted-foreground">{stat.description}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 p-4 bg-secondary/50 rounded-full w-fit">
            <BarChart3 className="h-12 w-12 text-muted-foreground" />
          </div>
          <CardTitle>詳細な統計は近日公開</CardTitle>
          <CardDescription>
            詳細な分析、トレンド、コミュニティインサイトは今後のアップデートで提供予定です。
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}
