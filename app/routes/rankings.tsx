import type { Route } from "./+types/rankings";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Trophy, Clock } from "lucide-react";
import { t } from "@/lib/messages";

export const meta: Route.MetaFunction = () => {
  return [
    { title: t("rankings.title") },
    { name: "description", content: t("rankings.description") },
  ];
};

export default function RankingsPage() {
  return (
    <div className="flex-1 flex flex-col space-y-6">
      <div>
        <h1 className="text-3xl font-bold">{t("rankings.pageTitle")}</h1>
        <p className="text-muted-foreground mt-1">
          {t("rankings.pageDescription")}
        </p>
      </div>

      <Card>
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 p-4 bg-secondary/50 rounded-full w-fit">
            <Trophy className="h-12 w-12 text-muted-foreground" />
          </div>
          <CardTitle>{t("rankings.comingSoonTitle")}</CardTitle>
          <CardDescription>
            {t("rankings.comingSoonDescription")}
          </CardDescription>
        </CardHeader>
        <CardContent className="text-center">
          <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <Clock className="h-4 w-4" />
            <span>{t("rankings.checkBackLater")}</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
