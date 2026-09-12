// Vercel Blob の「参照されているか」判定の単一実装。
// 監査（audit-orphan-blobs.ts）と削除（delete-orphan-blobs.ts）が同じロジックを使う。
//
// 削除スクリプトが監査と別実装になると、「監査では参照ありなのに削除側では孤児」という
// 食い違いが生の画像消失に直結する。判定は必ずここに集約すること。
//
// 突き合わせは URL 文字列ではなく **パス（pathname）** で行う。Blob の URL は
// ストア ID を含むホスト名を持つため、文字列比較だと将来ホストが変わったときに
// 全件を孤児と誤判定する。
import type { Client } from "@libsql/client";
import type { ListBlobResultBlob } from "@vercel/blob";
import { blobUrlToPathname, collectBlobPathnames } from "../../app/lib/blob-url";
import { listAllBlobs as listAllBlobsShared } from "../../app/lib/blob-storage.server";

/** Blob のパス分類（プレフィックスは各アップロード経路の実装と対） */
export type BlobCategory = "guideInline" | "guideCover" | "skin" | "unknown";

export const CATEGORY_LABEL: Record<BlobCategory, string> = {
  guideInline: "ガイド本文の画像",
  guideCover: "ガイドのカバー画像",
  skin: "カスタムスキン",
  unknown: "その他（分類不明）",
};

export function categorize(pathname: string): BlobCategory {
  if (pathname.startsWith("skins/")) return "skin";
  if (pathname.startsWith("guides/")) {
    // guides/<userId>/<guideId>/images/<uuid>.<ext> / guides/<userId>/<guideId>/cover-<suffix>.<ext>
    return pathname.includes("/images/") ? "guideInline" : "guideCover";
  }
  return "unknown";
}

/**
 * Blob の URL からパスを取り出して正規化する。
 * list() が返す pathname は先頭スラッシュ無し・デコード済みなので、それに揃える。
 *
 * 実装本体は app/lib/blob-url.ts の blobUrlToPathname（アカウント/ガイド削除の
 * 削除経路と共有）。ここでは既存の import 元向けに同名を re-export する。
 */
export { blobUrlToPathname as toPathname };

export interface ReferenceScan {
  /** 参照されている Blob のパス */
  referenced: Set<string>;
  guideCount: number;
  skinCount: number;
  /** 本文中の <img> タグ総数（抽出漏れの目安。外部画像も含む） */
  imgTagCount: number;
}

/**
 * DB 上で参照されている Blob のパスを集める。
 *
 * 走査対象は「その Blob を指し得る全ての列」。**ドラフト列を必ず含めること** —
 * 公開版から画像を消しただけの状態でドラフトがまだ参照していることがあり、
 * 見落とすと編集中のガイドの画像を消してしまう。
 */
export async function collectReferences(client: Client): Promise<ReferenceScan> {
  const referenced = new Set<string>();

  const guides = await client.execute(
    "SELECT content, draft_content, cover_image_url, draft_cover_image_url FROM guides",
  );
  let imgTagCount = 0;
  for (const row of guides.rows) {
    const columns = [
      row.content,
      row.draft_content,
      row.cover_image_url,
      row.draft_cover_image_url,
    ] as (string | null)[];
    for (const pathname of collectBlobPathnames(columns)) referenced.add(pathname);
    for (const body of [row.content, row.draft_content]) {
      imgTagCount += (((body as string | null) ?? "").match(/<img\b/g) ?? []).length;
    }
  }

  const users = await client.execute(
    "SELECT custom_skin_url FROM users WHERE custom_skin_url IS NOT NULL",
  );
  for (const row of users.rows) {
    for (const pathname of collectBlobPathnames([row.custom_skin_url as string | null])) {
      referenced.add(pathname);
    }
  }

  return {
    referenced,
    guideCount: guides.rows.length,
    skinCount: users.rows.length,
    imgTagCount,
  };
}

/**
 * Blob をページングしながら全件列挙する。
 *
 * 実装本体は app/lib/blob-storage.server.ts の listAllBlobs（アカウント/ガイド削除の
 * 削除経路と共有）。ここでは既存の呼び出し元（位置引数 token/onProgress）向けの薄いラッパー。
 */
export async function listAllBlobs(
  token: string,
  onProgress?: (count: number) => void,
): Promise<ListBlobResultBlob[]> {
  return listAllBlobsShared({ token, onProgress });
}

export interface OrphanBlob {
  pathname: string;
  /** del() に渡す URL */
  url: string;
  category: BlobCategory;
  size: number;
  uploadedAt: Date;
  ageDays: number;
}

export interface OrphanReport {
  orphans: OrphanBlob[];
  /** DB は参照しているのに Blob に存在しないパス（表示が壊れている参照） */
  broken: string[];
  blobCount: number;
  totalBytes: number;
  referencedBytes: number;
  orphanBytes: number;
  /** 孤児が全体に占める割合（0..1）。抽出ロジック破損の検知に使う */
  orphanRatio: number;
}

export function findOrphans(
  blobs: ListBlobResultBlob[],
  referenced: Set<string>,
  now: number = Date.now(),
): OrphanReport {
  const orphans: OrphanBlob[] = [];
  const existing = new Set<string>();
  let totalBytes = 0;
  let referencedBytes = 0;

  for (const blob of blobs) {
    existing.add(blob.pathname);
    totalBytes += blob.size;
    if (referenced.has(blob.pathname)) {
      referencedBytes += blob.size;
      continue;
    }
    const uploadedAt = new Date(blob.uploadedAt);
    orphans.push({
      pathname: blob.pathname,
      url: blob.url,
      category: categorize(blob.pathname),
      size: blob.size,
      uploadedAt,
      ageDays: Math.floor((now - uploadedAt.getTime()) / 86_400_000),
    });
  }

  const orphanBytes = totalBytes - referencedBytes;
  return {
    orphans,
    broken: [...referenced].filter((pathname) => !existing.has(pathname)),
    blobCount: blobs.length,
    totalBytes,
    referencedBytes,
    orphanBytes,
    orphanRatio: blobs.length > 0 ? orphans.length / blobs.length : 0,
  };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

/** 分類別の件数・サイズを表形式で出す */
export function printByCategory(orphans: OrphanBlob[]): void {
  const order: BlobCategory[] = ["guideInline", "guideCover", "skin", "unknown"];
  for (const category of order) {
    const rows = orphans.filter((o) => o.category === category);
    if (rows.length === 0) continue;
    const bytes = rows.reduce((sum, o) => sum + o.size, 0);
    console.log(
      `  ${CATEGORY_LABEL[category].padEnd(20)} ${String(rows.length).padStart(5)} 件 / ${formatBytes(bytes)}`,
    );
  }
}

/**
 * Blob の接続先トークンを取り出す。ストアは 1 つなので常に .env 由来。
 * DB 側だけ --remote で切り替わることに注意（呼び出し側で警告すること）。
 */
export function requireBlobToken(): string {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    console.error("❌ BLOB_READ_WRITE_TOKEN が未設定です（.env を確認してください）。");
    process.exit(1);
  }
  return token;
}

/**
 * main() の戻り値を終了コードにして、イベントループの自然終了に任せる。
 *
 * process.exit() を使わないのは、ローカル DB（file:）のネイティブクライアントを
 * 開いたまま強制終了すると Windows の libuv が
 * `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)` で落ち、
 * **指定した終了コードが 127 に化けて成否を判定できなくなる**ため
 * （リモート DB では再現しないので気づきにくい）。
 */
export async function runScript(
  client: { close: () => void },
  main: () => Promise<number>,
): Promise<void> {
  let code = 1;
  try {
    code = await main();
  } catch (e) {
    console.error(`\n❌ 予期しないエラー: ${String(e)}`);
    code = 1;
  } finally {
    try {
      client.close();
    } catch {
      /* 閉じられなくても終了コードは維持する */
    }
  }
  process.exitCode = code;
}

/** `--flag=value` 形式の引数を読む */
export function argValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((a) => a.startsWith(prefix))?.slice(prefix.length);
}

export function numberArg(name: string, fallback: number): number {
  const raw = argValue(name);
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    console.error(`❌ --${name} には 0 以上の数値を指定してください（受け取った値: ${raw}）。`);
    process.exit(1);
  }
  return parsed;
}
