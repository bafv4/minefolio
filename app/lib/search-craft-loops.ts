/**
 * サーチクラフトの「繋ぎ方（Loop）」共有ロジック。
 *
 * Loop は既存の search_crafts エントリを id 参照で順に繋ぎ、前後エントリの
 * searchStr からキー操作列（BS / ← / 全選択 / Home + 打鍵の4方式）を自動導出する。
 * Playground・ライブプレビュー・プロフィール表示などクライアント側からも
 * 直接呼ぶ純粋関数のみで構成するため `.server` にはしない
 * （app/lib/remap-utils.ts と同じ位置付け）。
 *
 * 重要: このモジュール内では searchStr の trim・正規化は一切行わない。
 * 先頭・末尾のスペースはスペースキー入力として意味を持つ既存仕様のため、
 * 呼び出し側から渡された文字列をそのまま扱う（docs/items-searchcraft.md 参照）。
 */

import { isPlainObject } from "./search-craft-variations";

/** Loop のステップ間遷移方式 */
export const LOOP_TRANSITION_TYPES = ["backspace", "arrowLeft", "selectAll", "home"] as const;
export type LoopTransitionType = (typeof LOOP_TRANSITION_TYPES)[number];

/**
 * ステップ間の遷移指定。
 * - backspace: BS を bsCount 回押してから続きを打つ
 * - arrowLeft: ← を arrowCount 回押してカーソルを末尾から arrowCount 文字戻し、
 *   その位置に文字列を挿入する（削除は伴わない。backspace と異なり末尾を残したまま挿入する）
 * - selectAll: Shift+Home で全選択してから打ち直す
 * - home: Home で先頭に戻り、先頭に打ち足す
 */
export type LoopTransition =
  | { type: "backspace"; bsCount: number }
  | { type: "arrowLeft"; arrowCount: number }
  | { type: "selectAll" }
  | { type: "home" };

/**
 * search_craft_loops.steps（JSON列）の1要素。
 * craftId は search_crafts.id への参照。transition は先頭ステップのみ null。
 */
export type LoopStepData = {
  craftId: string;
  /** 前ステップからの遷移。先頭ステップのみ null */
  transition: LoopTransition | null;
  /**
   * 参照先クラフトのバリエーション index（0始まり）。
   * シリアライズ時は 0 を省略する（既存データとバイト同一を保つため）。パース時は欠落=0・
   * 不正値も0に矯正する。メモリ上（parseLoopSteps/remapLoopSteps/remapVariationRefs の
   * 戻り値、エディタの状態）は常に明示した数値を持つ（hasChanges の JSON 比較を安定させるため。
   * 型としては任意のまま — 生の JSON.parse 直後の値だけ欠落しうる）。
   */
  variationIndex?: number;
};

/** variationIndex の正規化: 非負整数でなければ 0 に矯正する（欠落・不正値の両方を吸収） */
export function normalizeVariationIndex(value: number | undefined): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : 0;
}

/** prev と next の共通接頭辞の長さ（UTF-16コード単位での単純比較） */
export function commonPrefixLength(prev: string, next: string): number {
  const maxLength = Math.min(prev.length, next.length);
  let i = 0;
  while (i < maxLength && prev[i] === next[i]) {
    i++;
  }
  return i;
}

/** prev → next へ遷移するのに必要な最小BS回数（= prev.length - 共通接頭辞長） */
export function minBackspaceCount(prev: string, next: string): number {
  return prev.length - commonPrefixLength(prev, next);
}

/**
 * prev → next へ arrowLeft(k) 方式で遷移できる、妥当な最小の k。
 *
 * k=1 から prev.length まで順に走査し、最初に妥当条件
 * （next.length > prev.length かつ next が残存接頭辞 prev.slice(0, prev.length-k) から始まり、
 * 残存接尾辞 prev.slice(prev.length-k) で終わる）を満たす k を返す。
 * 妥当な k は連続しているとは限らない（周期的な文字列など、途中の k だけ有効なことがある）ため
 * 総当たりで探し、1件も見つからなければ null を返す（呼び出し側は既定値 1 のまま invalid 表示にする）。
 */
export function minArrowLeftCount(prev: string, next: string): number | null {
  if (next.length <= prev.length) return null;
  for (let k = 1; k <= prev.length; k++) {
    const remaining = prev.length - k;
    const prefix = prev.slice(0, remaining);
    const suffix = prev.slice(remaining);
    if (next.startsWith(prefix) && next.endsWith(suffix)) {
      return k;
    }
  }
  return null;
}

/** 導出されたキー操作の1要素。type の text は原文どおり（スペース保持） */
export type LoopKeyOp =
  | { kind: "backspace"; count: number }
  | { kind: "arrowLeft"; count: number }
  | { kind: "selectAll" }
  | { kind: "home" }
  | { kind: "type"; text: string };

/** 遷移が無効な理由 */
export type TransitionInvalidReason =
  /** bsCount が非整数・負・prev.length 超 */
  | "bs_out_of_range"
  /** backspace: next が残存接頭辞から始まらない（指定 k が最小BS回数未満のケースも含む） */
  | "prefix_mismatch"
  /** home: next が prev で終わらない、または next が prev より長くない */
  | "not_extension"
  /** arrowLeft: arrowCount が非整数・1未満・prev.length 超（0 は「末尾に追記」＝backspace(0) と等価のため範囲外） */
  | "arrow_out_of_range"
  /** arrowLeft: 挿入として成立しない（next が残存接頭辞から始まらない・残存接尾辞で終わらない・next が prev より長くない） */
  | "not_insertion"
  /** prev / next の searchStr が null または空文字列（resolveLoopSteps 側で設定） */
  | "missing_search_str";

export type DerivedTransition =
  | { valid: true; ops: LoopKeyOp[]; typed: string }
  | { valid: false; reason: TransitionInvalidReason };

/**
 * prev/next の searchStr と遷移指定からキー操作列を導出する。
 * missing_search_str は判定しない（呼び出し側で prev/next が非 null・非空であることを保証する。
 * resolveLoopSteps はその判定を担う）。空文字列を渡してもクラッシュはしない。
 *
 * - backspace(k): typed = next.slice(prev.length - k)。
 *   妥当条件は k が整数で 0 <= k <= prev.length、かつ
 *   next が残存接頭辞 prev.slice(0, prev.length - k) から始まること。
 *   ops は count>0 のときのみ backspace、typed が非空のときのみ type を含む
 *   （k=0 かつ prev===next のときは ops=[] になり得る）。
 * - arrowLeft(k): ← を k 回押してカーソルを末尾から k 文字戻し、その位置に文字列を挿入する
 *   （削除は伴わない）。next = prev.slice(0, prev.length-k) + typed + prev.slice(prev.length-k)、
 *   typed = next.slice(prev.length-k, next.length-k)。
 *   妥当条件は k が整数で 1 <= k <= prev.length（0 は backspace(0) と等価のため範囲外）、
 *   かつ next.length > prev.length、かつ next が残存接頭辞 prev.slice(0, prev.length-k) から
 *   始まり、残存接尾辞 prev.slice(prev.length-k) で終わること。
 *   ops = [arrowLeft(k), type(typed)]（妥当なら typed は常に非空になるため type は必ず入る）。
 *   妥当な k は連続しているとは限らない（周期的な文字列など）ため、選択中の k はその都度
 *   この関数で検証する（minArrowLeftCount は「最初に見つかる妥当な k」を返すだけで、
 *   それ以外の k が無効であることまでは保証しない）。
 * - selectAll: 常に妥当。ops = [selectAll, type(next 全体)]、typed = next
 * - home: 妥当条件は next.endsWith(prev) かつ next.length > prev.length。
 *   typed = next.slice(0, next.length - prev.length)、ops = [home, type(typed)]
 *
 * BS/← ステッパーの範囲（min/max）はこの関数の戻り値には含まれない。UI 側
 * （search-craft-loop-editor.tsx の TransitionRow）が minBackspaceCount()/prev.length・
 * minArrowLeftCount()/prev.length を直接使って自前で算出する。
 */
export function deriveTransition(
  prev: string,
  next: string,
  transition: LoopTransition,
): DerivedTransition {
  switch (transition.type) {
    case "backspace": {
      const { bsCount } = transition;
      if (!Number.isInteger(bsCount) || bsCount < 0 || bsCount > prev.length) {
        return { valid: false, reason: "bs_out_of_range" };
      }
      const remaining = prev.slice(0, prev.length - bsCount);
      if (!next.startsWith(remaining)) {
        return { valid: false, reason: "prefix_mismatch" };
      }
      const typed = next.slice(prev.length - bsCount);
      const ops: LoopKeyOp[] = [];
      if (bsCount > 0) ops.push({ kind: "backspace", count: bsCount });
      if (typed !== "") ops.push({ kind: "type", text: typed });
      return { valid: true, ops, typed };
    }
    case "arrowLeft": {
      const { arrowCount } = transition;
      if (!Number.isInteger(arrowCount) || arrowCount < 1 || arrowCount > prev.length) {
        return { valid: false, reason: "arrow_out_of_range" };
      }
      const remaining = prev.length - arrowCount;
      const prefix = prev.slice(0, remaining);
      const suffix = prev.slice(remaining);
      if (next.length <= prev.length || !next.startsWith(prefix) || !next.endsWith(suffix)) {
        return { valid: false, reason: "not_insertion" };
      }
      const typed = next.slice(remaining, next.length - arrowCount);
      const ops: LoopKeyOp[] = [{ kind: "arrowLeft", count: arrowCount }];
      if (typed !== "") ops.push({ kind: "type", text: typed });
      return { valid: true, ops, typed };
    }
    case "selectAll": {
      return {
        valid: true,
        ops: [{ kind: "selectAll" }, { kind: "type", text: next }],
        typed: next,
      };
    }
    case "home": {
      if (!next.endsWith(prev) || next.length <= prev.length) {
        return { valid: false, reason: "not_extension" };
      }
      const typed = next.slice(0, next.length - prev.length);
      return {
        valid: true,
        ops: [{ kind: "home" }, { kind: "type", text: typed }],
        typed,
      };
    }
  }
}

/** 文字列表示用のセグメント。typed: false は「そのステップで実際にはタイプしない（前ステップから検索欄に残存する）文字」を表す */
export type TypedCharSegment = { text: string; typed: boolean };

/**
 * ステップの文字列表示（サマリーチップ・クラフト実行マーカー内の文字列）を、
 * 「実際にタイプする文字」と「前ステップから検索欄に残存するだけの文字」に分割する。
 * 空セグメントは結果に含めない。
 *
 * - transition === null（先頭ステップ）: 全部 typed: true
 * - prev が null/空、または deriveTransition(prev, next, transition) が invalid: 全部 typed: true
 *   （判定不能時は薄くしない。この関数は表示専用の補助であり、無効判定自体は resolveLoopSteps /
 *   deriveTransition が別途担う）
 * - backspace(bsCount): 残存接頭辞（false）+ 続き（true）
 * - arrowLeft(arrowCount): 残存接頭辞（false）+ 挿入部（true）+ 残存接尾辞（false）
 * - selectAll: 全部 true（全選択して打ち直すため残存部分がない）
 * - home: 先頭追記部（true）+ 末尾に残る prev 部分（false）
 *
 * typed 部分の文字列は deriveTransition() が返す typed をそのまま使う（重複計算による
 * 食い違いを避けるため）。
 *
 * `derived` を渡すと（resolveLoopSteps 済みの ResolvedLoopStep.derived 等、呼び出し側が
 * 既に deriveTransition(prev, next, transition) を計算済みの場合）、内部での再計算を
 * スキップしてそれをそのまま使う。省略時はこれまでどおり内部で算出する。
 */
export function typedCharSegments(
  prev: string | null,
  next: string,
  transition: LoopTransition | null,
  derived?: DerivedTransition | null,
): TypedCharSegment[] {
  const segments: TypedCharSegment[] = [];
  const push = (text: string, typed: boolean) => {
    if (text !== "") segments.push({ text, typed });
  };

  if (transition === null || !prev) {
    push(next, true);
    return segments;
  }

  const resolvedDerived = derived ?? deriveTransition(prev, next, transition);
  if (!resolvedDerived.valid) {
    push(next, true);
    return segments;
  }

  switch (transition.type) {
    case "backspace": {
      const remaining = prev.slice(0, prev.length - transition.bsCount);
      push(remaining, false);
      push(resolvedDerived.typed, true);
      break;
    }
    case "arrowLeft": {
      const remainingLength = prev.length - transition.arrowCount;
      const prefix = prev.slice(0, remainingLength);
      const suffix = prev.slice(remainingLength);
      push(prefix, false);
      push(resolvedDerived.typed, true);
      push(suffix, false);
      break;
    }
    case "selectAll": {
      push(resolvedDerived.typed, true);
      break;
    }
    case "home": {
      push(resolvedDerived.typed, true);
      push(prev, false);
      break;
    }
  }

  return segments;
}

/** 参照解決済みの1ステップ */
export type ResolvedLoopStep = {
  craftId: string;
  /** 正規化済み（欠落・不正値は0に矯正）の参照先バリエーション index */
  variationIndex: number;
  /** 参照解決結果。null = 参照切れ（該当 craftId が見つからない） */
  craft: { searchStrs: string[]; withShifts?: boolean[] } | null;
  /**
   * このステップで実際に使う searchStr（craft.searchStrs[variationIndex]）。
   * 参照切れ・variationIndex が範囲外なら null（missing_search_str 判定に使う）。
   * 表示コンポーネントは必ずこちらを使うこと（craft.searchStrs[0] 等で再導出しない。
   * variationIndex を無視した固定 index での再導出は誤表示のバグ原因になる）。
   */
  searchStr: string | null;
  /**
   * このステップで実際に使うバリエーションの withShift（craft.withShifts[variationIndex]）。
   * 参照切れ・variationIndex が範囲外・呼び出し元が withShifts を渡していない（後方互換）場合は false。
   * 表示コンポーネントはこれを「そのステップの打鍵キー逆引き・Shift ラッパー表示」に使う:
   * 先頭ステップ（idx===0）は自身の値、以降のステップは「遷移先ステップ（=このステップ自身）」の
   * 値を type op に適用する（search-craft-loop-view.tsx の LoopKeySequence/TransitionOpsBadges 参照）。
   */
  withShift: boolean;
  transition: LoopTransition | null;
  /** 先頭ステップは null。missing_search_str（searchStr 欠落）もここに反映する */
  derived: DerivedTransition | null;
};

export type ResolvedLoop = { steps: ResolvedLoopStep[]; valid: boolean };

/**
 * Loop のステップ配列を参照解決し、全ステップの遷移導出と全体の valid を集約する。
 * 編集プレビュー・全表示コンポーネントの共通入口。
 *
 * getCraft は該当クラフトの全バリエーションの searchStr 配列（searchStrs）を返す。
 * withShifts（同じ並びの withShift 配列）は任意（後方互換のため省略可。省略時は各ステップの
 * withShift は false 扱いになる）。ステップの variationIndex が範囲外（対象クラフトの
 * バリエーション数以上）の場合は missing_search_str 扱いにする（クラッシュ・黙った誤導出はしない）。
 *
 * valid の条件:
 * - ステップ数が2以上
 * - 全ステップで craft が解決でき、variationIndex に対応する searchStr が非 null・非空
 * - 先頭以外の全ステップで derived.valid === true
 */
export function resolveLoopSteps(
  steps: LoopStepData[],
  getCraft: (craftId: string) => { searchStrs: string[]; withShifts?: boolean[] } | undefined,
): ResolvedLoop {
  const resolvedSteps: ResolvedLoopStep[] = steps.map((step) => {
    const craft = getCraft(step.craftId) ?? null;
    const variationIndex = normalizeVariationIndex(step.variationIndex);
    const inRange = !!craft && variationIndex >= 0 && variationIndex < craft.searchStrs.length;
    const searchStr = inRange ? craft!.searchStrs[variationIndex] : null;
    const withShift = inRange ? (craft!.withShifts?.[variationIndex] ?? false) : false;
    return {
      craftId: step.craftId,
      variationIndex,
      craft,
      searchStr,
      withShift,
      transition: step.transition,
      derived: null,
    };
  });

  let valid = resolvedSteps.length >= 2;

  const first = resolvedSteps[0];
  if (first && !first.searchStr) {
    valid = false;
  }

  for (let i = 1; i < resolvedSteps.length; i++) {
    const current = resolvedSteps[i];
    const prevSearchStr = resolvedSteps[i - 1].searchStr;
    const currentSearchStr = current.searchStr;
    const transition = current.transition;

    if (transition === null || !isValidLoopTransitionValue(transition)) {
      // 先頭以外は構造的に妥当な transition が必須（isValidLoopStepsShape で本来弾かれる想定）。
      // null に加え、破損スナップショット由来の未知 type 等「構造的に不正な値」も
      // ここで弾く（isValidLoopTransitionValue を通らない値のまま deriveTransition の
      // switch（default なし）に渡すと undefined を返しうるため）。
      // derived は null のまま Loop 全体を無効化するに留め、クラッシュしない
      valid = false;
      continue;
    }

    if (!prevSearchStr || !currentSearchStr) {
      current.derived = { valid: false, reason: "missing_search_str" };
      valid = false;
      continue;
    }

    current.derived = deriveTransition(prevSearchStr, currentSearchStr, transition);
    if (!current.derived.valid) valid = false;
  }

  return { steps: resolvedSteps, valid };
}

/**
 * LoopTransition（null 以外）としての構造妥当性を検証する（bsCount / arrowCount は非負整数）。
 * ここでは構造のみを見る（1 <= arrowCount <= prev.length 等の値域チェックは deriveTransition が担う）。
 */
export function isValidLoopTransitionValue(value: unknown): value is LoopTransition {
  if (!isPlainObject(value)) return false;
  if (value.type === "backspace") {
    return typeof value.bsCount === "number" && Number.isInteger(value.bsCount) && value.bsCount >= 0;
  }
  if (value.type === "arrowLeft") {
    return typeof value.arrowCount === "number" && Number.isInteger(value.arrowCount) && value.arrowCount >= 0;
  }
  return value.type === "selectAll" || value.type === "home";
}

/**
 * steps JSON 列の耐性パース。不正な JSON・不正な要素は捨てて [] を返す（SSR を落とさないため）。
 * 要素単位で検証し、壊れた要素だけを取り除く。ただし先頭ステップのみ transition が null という
 * 規則がフィルタ後も成立しない場合は、配列ごと [] にする。
 * variationIndex は欠落・不正値のどちらも 0 に矯正し、メモリ上は常に明示した数値を持たせる
 * （hasChanges の JSON 比較を安定させるため）。
 */
export function parseLoopSteps(json: string | null): LoopStepData[] {
  if (!json) return [];

  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];

  const steps: LoopStepData[] = [];
  for (const item of raw) {
    if (!isPlainObject(item)) continue;
    if (typeof item.craftId !== "string" || item.craftId === "") continue;
    const variationIndex = normalizeVariationIndex(item.variationIndex as number | undefined);
    const transition = item.transition;
    if (transition === null) {
      steps.push({ craftId: item.craftId, transition: null, variationIndex });
    } else if (isValidLoopTransitionValue(transition)) {
      steps.push({ craftId: item.craftId, transition, variationIndex });
    }
    // transition が上記どちらにも該当しない要素は捨てる
  }

  if (steps.length === 0) return [];
  if (steps[0].transition !== null) return [];
  if (steps.slice(1).some((step) => step.transition === null)) return [];

  return steps;
}

/**
 * LoopStepData[] としての構造検証（action の受け口用）。
 * 配列であること・各要素の型・bsCount が非負整数であること・
 * 先頭ステップのみ transition が null であること・要素数が2以上であることを検証する。
 * variationIndex は任意フィールド。存在する場合のみ非負整数であることを検証する
 * （欠落自体は許容 — parseLoopSteps 等が読み取り時に 0 へ矯正する）。
 */
export function isValidLoopStepsShape(value: unknown): value is LoopStepData[] {
  if (!Array.isArray(value) || value.length < 2) return false;
  return value.every((step, index) => {
    if (!isPlainObject(step)) return false;
    if (typeof step.craftId !== "string" || step.craftId === "") return false;
    if (
      step.variationIndex !== undefined &&
      !(typeof step.variationIndex === "number" && Number.isInteger(step.variationIndex) && step.variationIndex >= 0)
    ) {
      return false;
    }
    if (index === 0) return step.transition === null;
    return isValidLoopTransitionValue(step.transition);
  });
}

/**
 * ステップの craftId を idMap（旧id→新id）で引き換える。
 * saveAll の new-→cuid 採番、プリセット復元の旧→新id 引き換えで使う。
 * マップに存在しない craftId のステップ（削除済みエントリへの参照）は除去し、
 * 残りが2件未満になった場合は Loop ごと破棄する（null を返す）。
 * 除去により元の先頭ステップが失われた場合に備え、結果の先頭ステップの
 * transition は常に null にリセットする（先頭のみ null という規則を維持するため）。
 * variationIndex は id の引き換えとは無関係なのでそのまま（正規化した上で）引き継ぐ。
 */
export function remapLoopSteps(
  steps: LoopStepData[],
  idMap: Map<string, string>,
): LoopStepData[] | null {
  const remapped: LoopStepData[] = [];
  for (const step of steps) {
    const newCraftId = idMap.get(step.craftId);
    if (newCraftId === undefined) continue;
    remapped.push({
      craftId: newCraftId,
      transition: step.transition,
      variationIndex: normalizeVariationIndex(step.variationIndex),
    });
  }

  if (remapped.length < 2) return null;

  remapped[0] = { ...remapped[0], transition: null };
  return remapped;
}

/**
 * 指定 craftId のバリエーションが1件削除された（index=removedIndex）ことに伴い、
 * そのクラフトを参照する全ステップの variationIndex を付け替える。
 * - removedIndex より後ろ（> removedIndex）を参照していたステップは -1 する
 * - 結果が範囲外（0 未満、または newCount 以上）になったステップは 0 へ倒す
 *   （削除された index そのものを参照していたステップも、この条件に該当すれば 0 になる。
 *   該当しない場合＝削除後もまだ存在する index を指す位置関係になった場合は、
 *   そのまま「新しくその位置に来たバリエーション」を指す — ステップの除去はしない）
 * ステップ数・他のクラフトへの参照は変更しない。
 */
export function remapVariationRefs(
  steps: LoopStepData[],
  craftId: string,
  removedIndex: number,
  newCount: number,
): LoopStepData[] {
  return steps.map((step) => {
    if (step.craftId !== craftId) return step;
    const current = normalizeVariationIndex(step.variationIndex);
    let next = current > removedIndex ? current - 1 : current;
    if (next < 0 || next >= newCount) next = 0;
    return { ...step, variationIndex: next };
  });
}
