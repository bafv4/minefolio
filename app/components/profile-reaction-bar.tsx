import { useState } from "react";
import { Link } from "react-router";
import { cn } from "@/lib/utils";
import {
  PROFILE_REACTION_EMOJI_KEYS,
  PROFILE_REACTION_EMOJIS,
  type ProfileReactionEmoji,
} from "@/lib/profile-reactions";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { ProfileReactionPill } from "@/hooks/use-profile-reactions";
import { useT } from "@/hooks/use-locale";
import { SmilePlus } from "lucide-react";
import type { MessageKey } from "@/lib/messages";

interface ProfileReactionBarProps {
  /** PROFILE_REACTION_EMOJIS の並び順に固定した8件（呼び出し元の useProfileReactions() の返り値） */
  pills: ProfileReactionPill[];
  /** 絵文字リアクションのトグル（呼び出し元の useProfileReactions() の返り値） */
  toggle: (emoji: ProfileReactionEmoji) => void;
  /** 閲覧者がログイン済み（かつオンボーディング済み）か */
  isLoggedIn: boolean;
  className?: string;
}

// PROFILE_REACTION_EMOJIS と PROFILE_REACTION_EMOJI_KEYS は同じ並び順で対応する
const EMOJI_NAME_KEY_BY_EMOJI = new Map<ProfileReactionEmoji, MessageKey>(
  PROFILE_REACTION_EMOJIS.map((emoji, i) => [
    emoji,
    `profileReactions.emoji.${PROFILE_REACTION_EMOJI_KEYS[i]}` as MessageKey,
  ]),
);

/**
 * プロフィール絵文字リアクションのピル列 + 追加ボタン（docs/profile-reactions.md）。
 *
 * - ピルは count>0 の絵文字のみ、表示順は PROFILE_REACTION_EMOJIS 固定
 *   （カウント順だと押すたびに並びが跳ねるため）
 * - 未ログイン時はピルを静的表示にし、追加ボタンは `/login` への導線にする
 * - カウントが1件も無く未ログインの場合はバーごと非表示にする
 *   （ログイン済みなら0件でも追加ボタンを出す必要があるため表示する）
 * - `pills`/`toggle` は props で受け取るだけの表示コンポーネントで、内部で
 *   `useProfileReactions()` は呼ばない。呼び出し元は `/player/:slug` の
 *   タブを描画する親ページコンポーネント側にすること（対象は常に1プロフィールのみで
 *   Context を挟む理由がない点は use-profile-reactions.ts のコメント通りだが、
 *   Radix TabsContent は非アクティブ時に子要素を unmount するため、このバー自身の中で
 *   state を持つとタブ切替のたびに楽観的更新が失われて見た目が古い値に戻ってしまう）
 */
export function ProfileReactionBar({
  pills,
  toggle,
  isLoggedIn,
  className,
}: ProfileReactionBarProps) {
  const t = useT();
  const [paletteOpen, setPaletteOpen] = useState(false);

  const visiblePills = pills.filter((pill) => pill.count > 0);

  if (!isLoggedIn && visiblePills.length === 0) return null;

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-1.5 justify-center sm:justify-start",
        className,
      )}
    >
      {visiblePills.map((pill) => {
        const emojiName = t(EMOJI_NAME_KEY_BY_EMOJI.get(pill.emoji)!);

        if (!isLoggedIn) {
          return (
            <span
              key={pill.emoji}
              className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/50 px-2 py-0.5 text-sm tabular-nums"
              aria-label={t("profileReactions.pillAria", { emoji: emojiName, count: pill.count })}
            >
              <span aria-hidden>{pill.emoji}</span>
              <span>{pill.count}</span>
            </span>
          );
        }

        return (
          <button
            key={pill.emoji}
            type="button"
            disabled={pill.pending}
            onClick={() => toggle(pill.emoji)}
            aria-pressed={pill.reacted}
            aria-busy={pill.pending}
            aria-label={
              pill.reacted
                ? t("profileReactions.unreactAria", { emoji: emojiName, count: pill.count })
                : t("profileReactions.reactAria", { emoji: emojiName, count: pill.count })
            }
            className={cn(
              "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-sm tabular-nums transition-colors",
              "border-border bg-muted/50 hover:border-muted-foreground/40",
              pill.reacted && "border-brand/40 bg-brand/10 text-brand",
              "disabled:pointer-events-none",
            )}
          >
            <span aria-hidden>{pill.emoji}</span>
            <span>{pill.count}</span>
          </button>
        );
      })}

      {isLoggedIn ? (
        <Popover open={paletteOpen} onOpenChange={setPaletteOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              className="rounded-full"
              aria-label={t("profileReactions.addLabel")}
            >
              <SmilePlus className="h-4 w-4" aria-hidden />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-2" align="start">
            <div className="grid grid-cols-4 gap-1">
              {pills.map((pill) => (
                <button
                  key={pill.emoji}
                  type="button"
                  disabled={pill.pending}
                  aria-pressed={pill.reacted}
                  aria-label={t(EMOJI_NAME_KEY_BY_EMOJI.get(pill.emoji)!)}
                  onClick={() => {
                    toggle(pill.emoji);
                    setPaletteOpen(false);
                  }}
                  className={cn(
                    "rounded-md p-2 text-xl transition-colors hover:bg-accent disabled:pointer-events-none",
                    pill.reacted && "bg-brand/10",
                  )}
                >
                  <span aria-hidden>{pill.emoji}</span>
                </button>
              ))}
            </div>
          </PopoverContent>
        </Popover>
      ) : (
        <Button asChild variant="outline" size="sm">
          <Link to="/login">
            <SmilePlus className="mr-2 size-4" aria-hidden />
            {t("profileReactions.loginToReact")}
          </Link>
        </Button>
      )}
    </div>
  );
}
