// /me/* の action テスト用。本番では routes/me/_layout.tsx のミドルウェアが解決した「登録済みユーザー行」を
// RouterContextProvider に積み、子ルートの loader / action が使い回す。テストではミドルウェアを通らないので、
// signInAs で設定したセッション（getSession のモック）の discordId から users 行を引いて同じ形の context を作る。
// 呼び出し側のテストは `vi.mock("@/lib/session", ...)` で registeredUserContext を実物のまま残すこと。
import { RouterContextProvider } from "react-router";
import { eq } from "drizzle-orm";
import { registeredUserContext } from "@/lib/session";
import { schema, type TestDb } from "./test-db";

export async function makeMeContext(
  db: TestDb,
  getSession: () => Promise<{ user: { id: string } } | undefined> | { user: { id: string } } | undefined,
): Promise<RouterContextProvider> {
  const session = await getSession();
  const user = session
    ? await db.query.users.findFirst({ where: eq(schema.users.discordId, session.user.id) })
    : undefined;
  const context = new RouterContextProvider();
  context.set(registeredUserContext, user ?? null);
  return context;
}
