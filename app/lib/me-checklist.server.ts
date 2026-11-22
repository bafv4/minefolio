// /me/_layout の loader から呼ぶ、「はじめに」チェックリストの集計（判定そのものは me-guide.ts の純粋関数）。
import { count, eq } from "drizzle-orm";
import type { Database } from "./db";
import { categoryRecords, keybindings, playerConfigs, playstyles, users } from "./schema";
import { computeMeChecklist, type MeChecklistData } from "./me-guide";

type UserRow = typeof users.$inferSelect;

/** 閉じ済みなら null（欄を出さない）。全手順が済んでいても閉じるまでは返す（欄は達成表示になる。完了は doneCount >= total で導く）。 */
export async function loadMeChecklist(
  db: Database,
  user: Pick<UserRow, "id" | "mcid" | "bedrockMcid" | "bio" | "speedruncomUsername" | "speedruncomId" | "meChecklistDismissedAt">,
): Promise<MeChecklistData | null> {
  if (user.meChecklistDismissedAt) return null;
  const [keybindingRows, config, recordRows, playstyle] = await Promise.all([
    db.select({ n: count() }).from(keybindings).where(eq(keybindings.userId, user.id)),
    db.query.playerConfigs.findFirst({ where: eq(playerConfigs.userId, user.id) }),
    db.select({ n: count() }).from(categoryRecords).where(eq(categoryRecords.userId, user.id)),
    db.query.playstyles.findFirst({ where: eq(playstyles.userId, user.id) }),
  ]);
  const checklist = computeMeChecklist({
    mcid: user.mcid,
    bedrockMcid: user.bedrockMcid,
    bio: user.bio,
    speedruncomUsername: user.speedruncomUsername,
    speedruncomId: user.speedruncomId,
    keybindingCount: keybindingRows[0]?.n ?? 0,
    config: config ?? null,
    recordCount: recordRows[0]?.n ?? 0,
    playstyle: playstyle ?? null,
  });
  return checklist;
}
