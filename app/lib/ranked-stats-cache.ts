import { fetchMCSRRankedStats } from "./external-stats";
import { createStatsCache } from "./stats-cache";

// プロフィールのハイライト行と stats タブが同じ MCID の MCSR Ranked 統計を取りに行くため、
// MCID をキーに Promise を共有し、同じページ内では外部 API 呼び出しを 1 回にする（詳細は stats-cache.ts）。
const cache = createStatsCache(fetchMCSRRankedStats);

export const fetchMCSRRankedStatsCached = cache.fetchCached;
export const subscribeMCSRRankedStats = cache.subscribe;
