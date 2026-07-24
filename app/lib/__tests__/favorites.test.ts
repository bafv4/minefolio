import { describe, it, expect } from "vitest";
import {
  getFavoritesFromDb,
  addFavoriteToDb,
  removeFavoriteFromDb,
  syncLocalFavoritesToDb,
  isFavorite,
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
