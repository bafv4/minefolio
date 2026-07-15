/**
 * app_meta テーブル（アプリ全体のkey-valueメタデータ）の読み書きユーティリティ
 */

import { eq } from "drizzle-orm";
import { createDb } from "./db";
import { appMeta } from "./schema";

export async function getAppMeta(key: string): Promise<string | null> {
  const db = createDb();
  const row = await db.query.appMeta.findFirst({
    where: eq(appMeta.key, key),
  });
  return row?.value ?? null;
}

export async function setAppMeta(key: string, value: string): Promise<void> {
  const db = createDb();
  await db
    .insert(appMeta)
    .values({ key, value, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: appMeta.key,
      set: { value, updatedAt: new Date() },
    });
}
