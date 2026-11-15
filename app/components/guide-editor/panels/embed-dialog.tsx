// キー配置 / サーチクラフト埋め込みの挿入ダイアログ。
// 走者は自サイトの走者検索（/api/browse）の候補から選び、既定はログイン中の作者自身。プリセットは選んだ走者の
// プリセット一覧から選ぶ。選んだ組み合わせは公開ページと同じ規則で解決して要約を見せ、解決できなければ挿入できない。
// 保存する属性は従来どおり data-user-slug（解決した slug）と data-preset-name（既定なら無し）だけ。
import { useState, useEffect, useRef, useId } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MinecraftAvatar } from "@/components/minecraft-avatar";
import { useT, useLocale } from "@/hooks/use-locale";
import { getLocalizedDisplayName } from "@/lib/slug";
import { listEmbedPresetNames } from "@/lib/guide-embed-data";
import { useEmbedUser } from "../lib/embed-user-cache";
import { EmbedSummary, isEmbedResolved, type EmbedKind } from "./embed-summary";
import { ChevronsUpDown, Loader2 } from "lucide-react";

export type { EmbedKind };

interface EmbedDialogProps {
  /** 開いている埋め込み種別。null で非表示 */
  kind: EmbedKind | null;
  onOpenChange: (open: boolean) => void;
  onInsert: (kind: EmbedKind, slug: string, preset: string) => void;
  /** 既定の走者（ログイン中の作者自身の slug） */
  defaultUserSlug: string;
}

/** Radix Select は空文字の value を持てないため、「既定の設定」は番兵値で持ち、挿入時に空へ戻す */
const DEFAULT_PRESET_VALUE = "__default__";

const SEARCH_DEBOUNCE_MS = 250;

/** 走者検索（/api/browse）の1件。表示に使う項目だけ */
interface RunnerCandidate {
  slug: string;
  mcid: string | null;
  uuid: string | null;
  displayName: string | null;
  displayNameAlphabet: string | null;
  customSkinUrl: string | null;
}

export function EmbedDialog({ kind, onOpenChange, onInsert, defaultUserSlug }: EmbedDialogProps) {
  const t = useT();
  const [userSlug, setUserSlug] = useState(defaultUserSlug);
  const [preset, setPreset] = useState(DEFAULT_PRESET_VALUE);

  // 開くたびに既定（作者自身・既定の設定）へ戻す
  useEffect(() => {
    if (kind) {
      setUserSlug(defaultUserSlug);
      setPreset(DEFAULT_PRESET_VALUE);
    }
  }, [kind, defaultUserSlug]);

  // 選んだ走者を公開ページと同じ規則で解決する（走者が設定を変えていることがあるので、ダイアログでは取り直す）
  const state = useEmbedUser(kind ? userSlug : "", { fresh: true });
  const presetNames = state.status === "found" ? listEmbedPresetNames(state.user) : [];
  const presetName = preset === DEFAULT_PRESET_VALUE ? null : preset;
  const canInsert = !!kind && isEmbedResolved(state);

  const submit = () => {
    if (!kind || state.status !== "found") return;
    onInsert(kind, state.user.slug, presetName ?? "");
    onOpenChange(false);
  };

  const runnerLabelId = useId();
  const presetLabelId = useId();
  const presetTriggerId = useId();

  return (
    <Dialog open={kind !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {kind === "searchcraft"
              ? t("guideEditor.embedSearchCraftTitle")
              : t("guideEditor.embedKeybindTitle")}
          </DialogTitle>
          <DialogDescription>{t("guideEditor.embedDialogDesc")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label id={runnerLabelId}>{t("guideEditor.embedRunnerLabel")}</Label>
            <RunnerCombobox
              labelId={runnerLabelId}
              selectedSlug={userSlug}
              selected={state.status === "found" ? state.user : null}
              selfSlug={defaultUserSlug}
              onSelect={(slug) => {
                setUserSlug(slug);
                setPreset(DEFAULT_PRESET_VALUE);
              }}
            />
          </div>
          <div className="space-y-1.5">
            <Label id={presetLabelId}>{t("guideEditor.embedPresetLabel")}</Label>
            <Select value={preset} onValueChange={setPreset} disabled={state.status !== "found"}>
              {/* 名前はラベル＋選択中の値（label in name。ラベルだけだと選んだプリセットが名前に入らない） */}
              <SelectTrigger id={presetTriggerId} className="w-full" aria-labelledby={`${presetLabelId} ${presetTriggerId}`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={DEFAULT_PRESET_VALUE}>{t("guideEditor.embedPresetDefault")}</SelectItem>
                {presetNames.map((name) => (
                  <SelectItem key={name} value={name}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {state.status === "found" && presetNames.length === 0 && (
              <p className="text-xs text-muted-foreground">{t("guideEditor.embedPresetNone")}</p>
            )}
          </div>
          {/* プレビュー: 記事に出る中身の要約（解決できないときは理由） */}
          <div className="rounded-lg border border-border/70 bg-muted/30 px-3 py-2.5">
            <p className="mb-1 text-xs font-medium text-muted-foreground">{t("guideEditor.embedPreviewLabel")}</p>
            <div aria-live="polite">
              {kind && <EmbedSummary kind={kind} state={state} userQuery={userSlug} presetName={presetName} />}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            {t("guideEditor.embedCancel")}
          </Button>
          <Button size="sm" onClick={submit} disabled={!canInsert}>
            {t("guideEditor.embedInsert")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * 走者の combobox（Popover + Command）。候補は自サイトの走者検索（/api/browse。公開プロフィールの走者を
 * MCID・表示名で探す）。入力が空のときは自分だけを出す。絞り込みはサーバー側なので cmdk の絞り込みは切る
 */
function RunnerCombobox({
  labelId,
  selectedSlug,
  selected,
  selfSlug,
  onSelect,
}: {
  labelId: string;
  selectedSlug: string;
  /** 選んだ走者の解決結果（見つからないときは null） */
  selected: { slug: string; mcid: string | null; displayName: string | null; displayNameAlphabet: string | null } | null;
  selfSlug: string;
  onSelect: (slug: string) => void;
}) {
  const t = useT();
  const locale = useLocale();
  const triggerId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<RunnerCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (open) setQuery("");
  }, [open]);

  // debounce 検索。古い応答が新しい結果を上書きしないよう、前の問い合わせは中断する
  useEffect(() => {
    clearTimeout(timer.current);
    controllerRef.current?.abort();
    const q = query.trim();
    if (!open || !q) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const controller = new AbortController();
    controllerRef.current = controller;
    timer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/browse?q=${encodeURIComponent(q)}`, { signal: controller.signal });
        if (res.ok) {
          const data = (await res.json()) as { items: RunnerCandidate[] };
          setResults(data.items);
        }
      } catch {
        /* 中断・通信の失敗は結果なし */
      }
      if (!controller.signal.aborted) setLoading(false);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer.current);
  }, [query, open]);

  const triggerLabel = selected
    ? getLocalizedDisplayName(selected, locale)
    : selectedSlug || t("guideEditor.embedRunnerPlaceholder");
  const isSelf = selected ? selected.slug === selfSlug : selectedSlug === selfSlug;

  const choose = (slug: string) => {
    onSelect(slug);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          id={triggerId}
          role="combobox"
          aria-expanded={open}
          // 名前はラベル＋選択中の走者（ボタン自身の文字）。ラベルだけだと選んだ走者が名前に入らない
          aria-labelledby={`${labelId} ${triggerId}`}
          className="w-full justify-between font-normal"
        >
          <span className="min-w-0 truncate">
            {triggerLabel}
            {isSelf && <span className="ml-1 text-muted-foreground">{t("guideEditor.embedRunnerSelfMark")}</span>}
            {selected?.mcid && selected.mcid !== triggerLabel && (
              <span className="ml-1.5 text-xs text-muted-foreground">@{selected.mcid}</span>
            )}
          </span>
          <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder={t("guideEditor.embedRunnerSearchPlaceholder")}
            aria-label={t("guideEditor.embedRunnerSearchPlaceholder")}
          />
          <CommandList>
            {query.trim() === "" ? (
              <CommandGroup>
                <CommandItem value={`self:${selfSlug}`} onSelect={() => choose(selfSlug)}>
                  {t("guideEditor.embedRunnerSelf")}
                </CommandItem>
                <p className="px-2 py-1.5 text-xs text-muted-foreground">{t("guideEditor.embedRunnerSearchHint")}</p>
              </CommandGroup>
            ) : loading ? (
              <p className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground" role="status">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                {t("guideEditor.ui.searching")}
              </p>
            ) : (
              <>
                <CommandEmpty>{t("guideEditor.embedRunnerNone")}</CommandEmpty>
                <CommandGroup>
                  {results.map((runner) => {
                    const name = getLocalizedDisplayName(runner, locale);
                    return (
                      <CommandItem key={runner.slug} value={runner.slug} onSelect={() => choose(runner.slug)}>
                        <MinecraftAvatar
                          uuid={runner.uuid}
                          skinUrl={runner.customSkinUrl}
                          size={20}
                          alt=""
                          className="shrink-0 rounded-md"
                        />
                        <span className="min-w-0 truncate">{name}</span>
                        {runner.mcid && runner.mcid !== name && (
                          <span className="ml-auto shrink-0 text-xs text-muted-foreground">@{runner.mcid}</span>
                        )}
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
