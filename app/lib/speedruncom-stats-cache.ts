import { fetchSpeedrunComStats } from "./external-stats";
import { createStatsCache } from "./stats-cache";

// プロフィールのハイライト行と stats タブが同じ speedrun.com ユーザー名の統計を取りに行くため、
// ユーザー名をキーに Promise を共有し、同じページ内では外部 API 呼び出しを 1 回にする（詳細は stats-cache.ts）。
const cache = createStatsCache(fetchSpeedrunComStats);

export const fetchSpeedrunComStatsCached = cache.fetchCached;
export const subscribeSpeedrunComStats = cache.subscribe;
