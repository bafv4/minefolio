// @vitest-environment jsdom
// UnsavedChangesDialog の「保存して移動」: 成功で proceed、失敗・送信が始まらないときは reset。
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Blocker } from "react-router";
import { UnsavedChangesDialog, SAVE_START_TIMEOUT_MS, SAVE_SETTLE_TIMEOUT_MS } from "../unsaved-changes-dialog";

vi.mock("@/hooks/use-locale", () => ({
  useT: () => (key: string) => key,
}));

(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let mount: HTMLElement;
const proceed = vi.fn();
const reset = vi.fn();
const onSave = vi.fn();

function blocked(): Blocker {
  return { state: "blocked", location: {} as never, proceed, reset } as unknown as Blocker;
}

async function render(props: { isSubmitting: boolean; hasChanges: boolean; withSave?: boolean; saveResult?: unknown; saveSucceeded?: boolean }) {
  await act(async () => {
    root.render(
      createElement(UnsavedChangesDialog, {
        blocker: blocked(),
        onSave: props.withSave === false ? undefined : onSave,
        isSubmitting: props.isSubmitting,
        hasChanges: props.hasChanges,
        saveResult: props.saveResult,
        saveSucceeded: props.saveSucceeded,
      }),
    );
  });
}

function button(label: string): HTMLButtonElement {
  const el = Array.from(document.body.querySelectorAll("button")).find((b) =>
    b.textContent?.includes(label),
  );
  if (!el) throw new Error(`button not found: ${label}`);
  return el as HTMLButtonElement;
}

beforeEach(() => {
  vi.useFakeTimers();
  proceed.mockReset();
  reset.mockReset();
  onSave.mockReset();
  mount = document.createElement("div");
  document.body.appendChild(mount);
  root = createRoot(mount);
});

afterEach(() => {
  act(() => root.unmount());
  mount.remove();
  vi.useRealTimers();
});

describe("UnsavedChangesDialog", () => {
  it("onSave が無ければ「保存して移動」を出さない", async () => {
    await render({ isSubmitting: false, hasChanges: true, withSave: false });
    expect(document.body.textContent).not.toContain("common.saveAndLeave");
    expect(document.body.textContent).toContain("common.leaveWithoutSaving");
  });

  it("保存が成功したら proceed する", async () => {
    await render({ isSubmitting: false, hasChanges: true });
    await act(async () => button("common.saveAndLeave").click());
    expect(onSave).toHaveBeenCalledTimes(1);
    await render({ isSubmitting: true, hasChanges: true });
    expect(proceed).not.toHaveBeenCalled();
    await render({ isSubmitting: false, hasChanges: false });
    expect(proceed).toHaveBeenCalledTimes(1);
    expect(reset).not.toHaveBeenCalled();
  });

  it("送信が終わった直後は未保存が残っていても、少し後に解消すれば proceed する", async () => {
    // 画面側は保存結果を受け取った後の effect で下書きの基準を入れ替えるので、送信終了のレンダーではまだ未保存のことがある
    await render({ isSubmitting: false, hasChanges: true });
    await act(async () => button("common.saveAndLeave").click());
    await render({ isSubmitting: true, hasChanges: true });
    await render({ isSubmitting: false, hasChanges: true });
    expect(reset).not.toHaveBeenCalled();
    await render({ isSubmitting: false, hasChanges: false });
    expect(proceed).toHaveBeenCalledTimes(1);
    expect(reset).not.toHaveBeenCalled();
  });

  it("送信後も未保存が残れば一定時間後に reset する", async () => {
    await render({ isSubmitting: false, hasChanges: true });
    await act(async () => button("common.saveAndLeave").click());
    await render({ isSubmitting: true, hasChanges: true });
    await render({ isSubmitting: false, hasChanges: true });
    await act(async () => {
      vi.advanceTimersByTime(SAVE_SETTLE_TIMEOUT_MS + 10);
    });
    expect(reset).toHaveBeenCalledTimes(1);
    expect(proceed).not.toHaveBeenCalled();
  });

  it("送信が始まらなければ一定時間後に reset する", async () => {
    await render({ isSubmitting: false, hasChanges: true });
    await act(async () => button("common.saveAndLeave").click());
    await act(async () => {
      vi.advanceTimersByTime(SAVE_START_TIMEOUT_MS + 10);
    });
    expect(reset).toHaveBeenCalledTimes(1);
    expect(proceed).not.toHaveBeenCalled();
  });

  it("「保存せず離れる」は保存せず proceed する", async () => {
    await render({ isSubmitting: false, hasChanges: true });
    await act(async () => button("common.leaveWithoutSaving").click());
    expect(proceed).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
  });

  describe("saveResult / saveSucceeded を渡す場合", () => {
    const first = { success: true };
    const second = { success: false };

    async function startSave(result: unknown, succeeded: boolean) {
      await render({ isSubmitting: false, hasChanges: true, saveResult: result, saveSucceeded: succeeded });
      await act(async () => button("common.saveAndLeave").click());
      await render({ isSubmitting: true, hasChanges: true, saveResult: result, saveSucceeded: succeeded });
    }

    it("結果が届いて成功なら、未保存が残っていても proceed する", async () => {
      await startSave(undefined, false);
      await render({ isSubmitting: false, hasChanges: true, saveResult: first, saveSucceeded: true });
      expect(proceed).toHaveBeenCalledTimes(1);
      expect(reset).not.toHaveBeenCalled();
    });

    it("結果が届いて失敗なら、未保存が消えていても reset する（proceed しない）", async () => {
      await startSave(first, true);
      await render({ isSubmitting: false, hasChanges: false, saveResult: second, saveSucceeded: false });
      expect(reset).toHaveBeenCalledTimes(1);
      expect(proceed).not.toHaveBeenCalled();
    });

    it("送信が終わっても結果が届かなければ、待って reset する（未保存が消えても proceed しない）", async () => {
      await startSave(first, true);
      await render({ isSubmitting: false, hasChanges: false, saveResult: first, saveSucceeded: true });
      expect(proceed).not.toHaveBeenCalled();
      expect(reset).not.toHaveBeenCalled();
      await act(async () => {
        vi.advanceTimersByTime(SAVE_SETTLE_TIMEOUT_MS + 10);
      });
      expect(reset).toHaveBeenCalledTimes(1);
      expect(proceed).not.toHaveBeenCalled();
    });

    it("送信が終わった後に結果が届いても、待っている間なら成功で proceed する", async () => {
      await startSave(first, true);
      await render({ isSubmitting: false, hasChanges: true, saveResult: first, saveSucceeded: true });
      await render({ isSubmitting: false, hasChanges: true, saveResult: second, saveSucceeded: true });
      expect(proceed).toHaveBeenCalledTimes(1);
    });
  });
});
