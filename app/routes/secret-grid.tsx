import { createTranslator } from "@/lib/messages";
import { localeFromMatches } from "@/lib/locale";
import { redirect, useLoaderData } from "react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Route } from "./+types/secret-grid";
import { createDb } from "@/lib/db";
import { users } from "@/lib/schema";
import { excludeViewersCondition } from "@/lib/users-filter";
import { and, desc, eq } from "drizzle-orm";
import { ProfileFeedCard, type ProfileFeedCardPlayer } from "@/components/profile-feed-card";
import { warmAvatars } from "@/lib/avatar-cache";
import { useT } from "@/hooks/use-locale";
import { Sparkles } from "lucide-react";

export const meta: Route.MetaFunction = ({ matches }) => {
  const t = createTranslator(localeFromMatches(matches));
  return [
    { title: t("secretGrid.title") },
    { name: "robots", content: "noindex" },
  ];
};

// プールから重複アリで4件をランダム抽出する（同じプレイヤーが複数セルに出てもよい）。
function pickFour<T>(pool: T[]): T[] {
  if (pool.length === 0) return [];
  return Array.from({ length: 4 }, () => pool[Math.floor(Math.random() * pool.length)]);
}

export async function loader({ request }: Route.LoaderArgs) {
  // 直アクセス・クローラー対策: ホーム画面からのクライアント遷移（データ取得リクエスト）
  // のみ許可する。URL直打ちやクローラーはドキュメントリクエストになるため弾く。
  const fetchDest = request.headers.get("Sec-Fetch-Dest");
  if (fetchDest === "document") {
    throw redirect("/");
  }

  const db = createDb();

  // 「最近更新されたプロフィール」と同じ条件で、入れ替え用に全件取得
  const pool = await db.query.users.findMany({
    where: and(eq(users.profileVisibility, "public"), excludeViewersCondition),
    columns: {
      mcid: true,
      uuid: true,
      slug: true,
      displayName: true,
      displayNameAlphabet: true,
      pronouns: true,
      role: true,
      mainEdition: true,
      mainPlatform: true,
      inputMethod: true,
      updatedAt: true,
      shortBio: true,
      customSkinUrl: true,
    },
    orderBy: [desc(users.updatedAt)],
  });

  return { pool };
}

export default function SecretGridPage() {
  const t = useT();
  const { pool } = useLoaderData<typeof loader>();
  const [cells, setCells] = useState<ProfileFeedCardPlayer[]>(() => pool.slice(0, 4));
  const containerRef = useRef<HTMLDivElement>(null);

  const shuffle = useCallback(() => {
    setCells(pickFour(pool));
  }, [pool]);

  // フォーカスされた状態で T キーを押すとグリッドの内容をランダムに入れ替える
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === "t" || e.key === "T") {
        e.preventDefault();
        shuffle();
      }
    },
    [shuffle]
  );

  // 初期表示時に自動でフォーカスを当てる
  useEffect(() => {
    containerRef.current?.focus();
  }, []);

  // プール内の全プレイヤーのスキンを順次プリロードしてキャッシュに入れておく。
  // これにより入れ替え（重複アリ）の際もアバターを即座に表示できる。
  useEffect(() => warmAvatars(pool), [pool]);

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      className="flex min-h-[70vh] flex-1 flex-col items-center justify-center gap-6 outline-none"
    >
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Sparkles className="h-4 w-4 text-primary" />
        <span>{t("secretGrid.hint")}</span>
      </div>

      {cells.length > 0 ? (
        <div className="grid w-full max-w-2xl grid-cols-2 gap-4">
          {cells.map((player, index) => (
            <ProfileFeedCard key={`${player.slug}-${index}`} player={player} />
          ))}
        </div>
      ) : (
        <p className="text-muted-foreground">{t("secretGrid.empty")}</p>
      )}
    </div>
  );
}
