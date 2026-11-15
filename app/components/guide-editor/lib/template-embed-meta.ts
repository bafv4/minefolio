// テンプレート埋め込み（ID だけを持つ）の編集中表示用に、タイトル・言語を引く軽いキャッシュ。
// NodeView は再マウントが多いため、モジュール内で保持する。挿入時はダイアログの選択結果で先に埋める。
import { isValidTemplateId } from "@/lib/guide-embed-attrs";

export interface TemplateEmbedMeta {
  id: string;
  title: string;
  gameLanguage: string | null;
  craftCount: number;
  authorName: string;
  isPublished: boolean;
  isOwn: boolean;
}

/** null = 取得済みだが見つからない */
const cache = new Map<string, TemplateEmbedMeta | null>();
const inflight = new Map<string, Promise<TemplateEmbedMeta | null>>();

export function primeTemplateEmbedMeta(meta: TemplateEmbedMeta): void {
  cache.set(meta.id, meta);
}

export function getCachedTemplateEmbedMeta(id: string): TemplateEmbedMeta | null | undefined {
  return cache.get(id);
}

export function fetchTemplateEmbedMeta(id: string): Promise<TemplateEmbedMeta | null> {
  if (!isValidTemplateId(id)) return Promise.resolve(null);
  if (cache.has(id)) return Promise.resolve(cache.get(id) ?? null);
  const pending = inflight.get(id);
  if (pending) return pending;
  const promise = fetch(`/api/guides/templates-search?id=${encodeURIComponent(id)}`)
    .then(async (res) => {
      if (!res.ok) return undefined;
      const data = (await res.json()) as { templates: TemplateEmbedMeta[] };
      return data.templates[0] ?? null;
    })
    .catch(() => undefined)
    .then((meta) => {
      inflight.delete(id);
      // 通信失敗（undefined）はキャッシュしない（次回再試行）
      if (meta !== undefined) cache.set(id, meta);
      return meta ?? null;
    });
  inflight.set(id, promise);
  return promise;
}
