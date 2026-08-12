import { useId } from "react";
import { cn } from "@/lib/utils";
import { useT } from "@/hooks/use-locale";
import type { MCSRRankedMatch } from "@/lib/external-stats";

interface EloRateGraphProps {
  matches: MCSRRankedMatch[];
}

/**
 * MCSR Ranked の直近試合における Elo レート推移グラフ（SVG折れ線）。
 * プロフィール詳細（player/profile.tsx）と統計ページ（player/stats.tsx）で
 * ほぼ同一実装が二重化していたのをここへ一本化。
 *
 * 色はテーマトークン（--success / --destructive）を使う。SVG の fill/stroke は
 * Tailwind クラスではなく実際の色値が必要なため var() 文字列で直接渡す。
 */
export function EloRateGraph({ matches }: EloRateGraphProps) {
  const t = useT();
  // 同一ページに複数描画されても <linearGradient id> が衝突しないように一意化する
  const gradientId = `eloRateGraphGradient-${useId()}`;

  // Eloレートが0のマッチを除外してから古い順に並べ替え（グラフ表示用）
  const validMatches = matches.filter((m) => m.eloAfter > 0);
  const sortedMatches = [...validMatches].reverse();

  if (sortedMatches.length < 2) return null;

  // Eloレートの配列を作成
  const eloHistory = sortedMatches.map((m) => m.eloAfter);
  const minElo = Math.min(...eloHistory);
  const maxElo = Math.max(...eloHistory);
  const range = maxElo - minElo || 100; // 変動がない場合のデフォルト

  // グラフのサイズ
  const width = 300;
  const height = 80;
  const padding = { top: 10, bottom: 20, left: 0, right: 0 };
  const graphWidth = width - padding.left - padding.right;
  const graphHeight = height - padding.top - padding.bottom;

  // ポイントの計算
  const points = eloHistory.map((elo, i) => {
    const x = padding.left + (i / (eloHistory.length - 1)) * graphWidth;
    const y = padding.top + graphHeight - ((elo - minElo) / range) * graphHeight;
    return { x, y, elo };
  });

  // SVGパスの作成
  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");

  // グラデーション用のエリアパス
  const areaPath = `${linePath} L ${points[points.length - 1].x} ${height - padding.bottom} L ${padding.left} ${height - padding.bottom} Z`;

  // 最初と最後のEloの変化
  const eloChange = eloHistory[eloHistory.length - 1] - eloHistory[0];
  const isPositive = eloChange >= 0;
  const strokeColor = isPositive ? "var(--success)" : "var(--destructive)";

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium text-muted-foreground">
          {t("playerProfile.eloTrend", { count: sortedMatches.length })}
        </h4>
        <span
          className={cn(
            "text-sm font-medium",
            isPositive ? "text-success" : "text-destructive",
          )}
        >
          {isPositive ? "+" : ""}
          {eloChange}
        </span>
      </div>
      <div className="bg-secondary/30 rounded-lg p-3">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full h-auto"
          style={{ maxHeight: "100px" }}
        >
          {/* グラデーションの定義 */}
          <defs>
            <linearGradient id={gradientId} x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor={strokeColor} stopOpacity="0.3" />
              <stop offset="100%" stopColor={strokeColor} stopOpacity="0.05" />
            </linearGradient>
          </defs>

          {/* エリア塗りつぶし */}
          <path d={areaPath} fill={`url(#${gradientId})`} />

          {/* ライン */}
          <path
            d={linePath}
            fill="none"
            stroke={strokeColor}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* ポイント（最初と最後のみ） */}
          <circle cx={points[0].x} cy={points[0].y} r="3" fill={strokeColor} />
          <circle
            cx={points[points.length - 1].x}
            cy={points[points.length - 1].y}
            r="4"
            fill={strokeColor}
          />

          {/* 最小・最大ラベル */}
          <text
            x={padding.left}
            y={height - 4}
            fontSize="10"
            fill="currentColor"
            className="text-muted-foreground"
          >
            {eloHistory[0]}
          </text>
          <text
            x={width - padding.right}
            y={height - 4}
            fontSize="10"
            fill="currentColor"
            className="text-muted-foreground"
            textAnchor="end"
          >
            {eloHistory[eloHistory.length - 1]}
          </text>
        </svg>
      </div>
    </div>
  );
}
