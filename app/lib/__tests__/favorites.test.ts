import { describe, it, expect } from "vitest";
import {
  getFavoritesFromDb,
  addFavoriteToDb,
  removeFavoriteFromDb,
  syncLocalFavoritesToDb,
  isFavorite,
  retargetFavoritesOnSlugChange,
} from "../favorites";
import { createTestDb, seedUser } from "./helpers/test-db";

describe("isFavorite（純関数）", () => {
  it("リストに含まれる slug は true、含まれなければ false", () => {
    expect(isFavorite(["a", "b"], "a")).toBe(true);
    expect(isFavorite(["a", "b"], "c")).toBe(false);
    expect(isFavorite([], "a")).toBe(false);
  });
});

describe("お気に入り DB ラウンドトリップ", () => {
  it("add → get で追加した slug が取得できる", async () => {
    const db = await createTestDb();
    const user = await seedUser(db, { slug: "me" });

    await addFavoriteToDb(db, user.id, "dream");
    await addFavoriteToDb(db, user.id, "andrew");

    const list = await getFavoritesFromDb(db, user.id);
    expect(list.sort()).toEqual(["andrew", "dream"]);
  });

  it("同じ slug の add は重複追加されない（冪等）", async () => {
    const db = await createTestDb();
    const user = await seedUser(db, { slug: "me" });

    await addFavoriteToDb(db, user.id, "dream");
    await addFavoriteToDb(db, user.id, "dream");

    expect(await getFavoritesFromDb(db, user.id)).toEqual(["dream"]);
  });

  it("remove で削除できる", async () => {
    const db = await createTestDb();
    const user = await seedUser(db, { slug: "me" });
    await addFavoriteToDb(db, user.id, "dream");
    await addFavoriteToDb(db, user.id, "andrew");

    await removeFavoriteFromDb(db, user.id, "dream");
    expect(await getFavoritesFromDb(db, user.id)).toEqual(["andrew"]);
  });

  it("お気に入りはユーザーごとに分離される", async () => {
    const db = await createTestDb();
    const a = await seedUser(db, { slug: "a" });
    const b = await seedUser(db, { slug: "b" });
    await addFavoriteToDb(db, a.id, "dream");

    expect(await getFavoritesFromDb(db, a.id)).toEqual(["dream"]);
    expect(await getFavoritesFromDb(db, b.id)).toEqual([]);
  });
});

describe("syncLocalFavoritesToDb", () => {
  it("既存分はスキップし、不足分のみ追加する（重複を作らない）", async () => {
    const db = await createTestDb();
    const user = await seedUser(db, { slug: "me" });
    await addFavoriteToDb(db, user.id, "dream");

    // 入力側の重複（andrew×2）も除去され、既存の dream は二重にならない
    await syncLocalFavoritesToDb(db, user.id, ["dream", "andrew", "andrew", "feinberg"]);

    const list = await getFavoritesFromDb(db, user.id);
    expect(list.sort()).toEqual(["andrew", "dream", "feinberg"]);
  });

  it("空配列を渡しても何もせず既存を保持する", async () => {
    const db = await createTestDb();
    const user = await seedUser(db, { slug: "me" });
    await addFavoriteToDb(db, user.id, "dream");

    await syncLocalFavoritesToDb(db, user.id, []);
    expect(await getFavoritesFromDb(db, user.id)).toEqual(["dream"]);
  });
});

describe("retargetFavoritesOnSlugChange（slug変更時の追従更新）", () => {
  it("旧slugを指す複数ユーザーのfavorites行がすべて新slugへ更新される", async () => {
    const db = await createTestDb();
    const alice = await seedUser(db, { slug: "alice" });
    const bob = await seedUser(db, { slug: "bob" });
    await addFavoriteToDb(db, alice.id, "runner");
    await addFavoriteToDb(db, bob.id, "runner");

    await retargetFavoritesOnSlugChange(db, { oldSlug: "runner", newSlug: "runner2" });

    expect(await getFavoritesFromDb(db, alice.id)).toEqual(["runner2"]);
    expect(await getFavoritesFromDb(db, bob.id)).toEqual(["runner2"]);
  });

  it("新slugを指す既存の孤児行は削除される（同一userIdが旧slug行と新slug孤児行の両方を持っていてもユニーク制約違反にならない）", async () => {
    const db = await createTestDb();
    const alice = await seedUser(db, { slug: "alice" });
    // alice は "runner"（旧slug）と "runner2"（以前別ユーザーが持っていた新slug）の両方を
    // お気に入り登録済み。delete→updateの順で処理しないと update 時にユニーク制約違反になる
    await addFavoriteToDb(db, alice.id, "runner");
    await addFavoriteToDb(db, alice.id, "runner2");

    await expect(
      retargetFavoritesOnSlugChange(db, { oldSlug: "runner", newSlug: "runner2" }),
    ).resolves.not.toThrow();

    expect(await getFavoritesFromDb(db, alice.id)).toEqual(["runner2"]);
  });

  it("oldSlug === newSlug（完全一致）のときは何もしない", async () => {
    const db = await createTestDb();
    const alice = await seedUser(db, { slug: "alice" });
    await addFavoriteToDb(db, alice.id, "runner");

    await retargetFavoritesOnSlugChange(db, { oldSlug: "runner", newSlug: "runner" });

    expect(await getFavoritesFromDb(db, alice.id)).toEqual(["runner"]);
  });

  it("大文字小文字だけのslug変更（alice→Alice）でも完全一致比較により追従される", async () => {
    const db = await createTestDb();
    const fan = await seedUser(db, { slug: "fan" });
    await addFavoriteToDb(db, fan.id, "alice");

    await retargetFavoritesOnSlugChange(db, { oldSlug: "alice", newSlug: "Alice" });

    expect(await getFavoritesFromDb(db, fan.id)).toEqual(["Alice"]);
  });

  it("無関係なfavoriteSlugの行は変更されない", async () => {
    const db = await createTestDb();
    const fan = await seedUser(db, { slug: "fan" });
    await addFavoriteToDb(db, fan.id, "runner");
    await addFavoriteToDb(db, fan.id, "someone-else");

    await retargetFavoritesOnSlugChange(db, { oldSlug: "runner", newSlug: "runner2" });

    expect((await getFavoritesFromDb(db, fan.id)).sort()).toEqual(["runner2", "someone-else"]);
  });
});
