// 短い動画を GIF に変換して本文へ挿入するダイアログ。
// 変換ロジックは lib/video-to-gif.ts に置き、ここは範囲・幅・fps の指定と進捗表示だけを持つ。
// 生成した GIF のアップロードと挿入は呼び出し側（GuideEditor）が既存の画像経路で行う。
import { useState, useEffect, useRef, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Progress } from "@/components/ui/progress";
import { Film, Loader2 } from "lucide-react";
import { t } from "@/lib/messages";
import { MAX_UPLOAD_BYTES } from "../hooks/use-image-upload";
import {
  convertVideoToGif,
  resolveVideoDuration,
  clampTrimRange,
  planGifFrames,
  VideoDecodeError,
  GifTooLargeError,
  GIF_MAX_DURATION_SEC,
  GIF_WIDTH_PRESETS,
  GIF_FPS_PRESETS,
} from "../lib/video-to-gif";

/** 既定値: 480px / 10fps は「ガイドの本文幅に収まり、上限内に収まりやすい」組み合わせ */
const DEFAULT_WIDTH = 480;
const DEFAULT_FPS = 10;

function toMb(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(1);
}

interface VideoToGifDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 変換できた GIF を受け取る（アップロードと挿入は呼び出し側） */
  onInsert: (file: File) => void;
}

export function VideoToGifDialog({ open, onOpenChange, onInsert }: VideoToGifDialogProps) {
  const [file, setFile] = useState<File | null>(null);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const [range, setRange] = useState({ startSec: 0, endSec: 0 });
  const [maxWidth, setMaxWidth] = useState<number>(DEFAULT_WIDTH);
  const [fps, setFps] = useState<number>(DEFAULT_FPS);
  const [converting, setConverting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // 選び直し・閉じたときに前の動画の Blob URL を解放する
  useEffect(() => {
    if (!file) {
      setObjectUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setObjectUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  // 閉じたら状態を捨てる（次に開いたとき前の動画が残らないように）
  useEffect(() => {
    if (open) return;
    abortRef.current?.abort();
    abortRef.current = null;
    setFile(null);
    setDuration(null);
    setRange({ startSec: 0, endSec: 0 });
    setConverting(false);
    setProgress(0);
    setError(null);
  }, [open]);

  const selectFile = (picked: File | undefined) => {
    if (!picked) return;
    setError(null);
    setDuration(null);
    setFile(picked);
  };

  const handleLoaded = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;
    try {
      const seconds = await resolveVideoDuration(video);
      setDuration(seconds);
      setRange(clampTrimRange({ startSec: 0, endSec: seconds }, seconds, "start"));
    } catch {
      setError(t("guideEditor.gifDecodeError"));
    }
  }, []);

  const updateRange = (next: { startSec: number; endSec: number }, anchor: "start" | "end") => {
    if (duration === null) return;
    setRange(clampTrimRange(next, duration, anchor));
  };

  /** 再生位置を切り出しの開始 / 終了に取り込む（スライダーより狙いを付けやすい） */
  const applyCurrentTime = (anchor: "start" | "end") => {
    const video = videoRef.current;
    if (!video || duration === null) return;
    const at = video.currentTime;
    updateRange(anchor === "start" ? { ...range, startSec: at } : { ...range, endSec: at }, anchor);
  };

  const convert = async () => {
    if (!file || duration === null) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setConverting(true);
    setProgress(0);
    setError(null);
    try {
      const gif = await convertVideoToGif(file, {
        maxWidth,
        fps,
        startSec: range.startSec,
        endSec: range.endSec,
        maxBytes: MAX_UPLOAD_BYTES,
        onProgress: (ratio) => setProgress(Math.round(ratio * 100)),
        signal: controller.signal,
      });
      onInsert(gif);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return; // 閉じた
      if (e instanceof GifTooLargeError) {
        setError(
          t("guideEditor.gifTooLarge", {
            size: toMb(e.actualBytes),
            max: toMb(MAX_UPLOAD_BYTES),
          }),
        );
      } else if (e instanceof VideoDecodeError) {
        setError(t("guideEditor.gifDecodeError"));
      } else {
        console.error("GIF conversion failed:", e);
        setError(t("guideEditor.gifConvertError"));
      }
    } finally {
      abortRef.current = null;
      setConverting(false);
    }
  };

  const frameCount =
    duration === null ? 0 : planGifFrames(range.startSec, range.endSec, fps).times.length;
  const clipLength = Math.max(0, range.endSec - range.startSec);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("guideEditor.gifTitle")}</DialogTitle>
          <DialogDescription>
            {t("guideEditor.gifDesc", { seconds: GIF_MAX_DURATION_SEC })}
          </DialogDescription>
        </DialogHeader>

        <input
          ref={inputRef}
          type="file"
          accept="video/*"
          className="hidden"
          onChange={(e) => {
            selectFile(e.target.files?.[0]);
            e.target.value = "";
          }}
        />

        {!objectUrl ? (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="flex flex-col items-center gap-2 rounded-lg border border-dashed px-4 py-10 text-sm text-muted-foreground transition-colors hover:border-primary hover:text-foreground"
          >
            <Film className="h-8 w-8" />
            {t("guideEditor.gifPickVideo")}
          </button>
        ) : (
          <div className="space-y-4">
            {/* 元動画のプレビュー。ここで頭出ししてから範囲へ取り込む */}
            <video
              ref={videoRef}
              src={objectUrl}
              controls
              muted
              playsInline
              preload="auto"
              onLoadedData={handleLoaded}
              className="max-h-[35vh] w-full rounded-md bg-black"
            />

            {duration !== null && (
              <>
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <label className="text-xs text-muted-foreground">
                        {t("guideEditor.gifStart", { sec: range.startSec.toFixed(1) })}
                      </label>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-xs"
                        onClick={() => applyCurrentTime("start")}
                        disabled={converting}
                      >
                        {t("guideEditor.gifUseCurrent")}
                      </Button>
                    </div>
                    <Slider
                      min={0}
                      max={duration}
                      step={0.1}
                      value={[range.startSec]}
                      onValueChange={([v]) => updateRange({ ...range, startSec: v }, "start")}
                      disabled={converting}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <label className="text-xs text-muted-foreground">
                        {t("guideEditor.gifEnd", { sec: range.endSec.toFixed(1) })}
                      </label>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-xs"
                        onClick={() => applyCurrentTime("end")}
                        disabled={converting}
                      >
                        {t("guideEditor.gifUseCurrent")}
                      </Button>
                    </div>
                    <Slider
                      min={0}
                      max={duration}
                      step={0.1}
                      value={[range.endSec]}
                      onValueChange={([v]) => updateRange({ ...range, endSec: v }, "end")}
                      disabled={converting}
                    />
                  </div>
                </div>

                <div className="flex flex-wrap gap-x-6 gap-y-2">
                  <div className="space-y-1.5">
                    <span className="text-xs text-muted-foreground">
                      {t("guideEditor.gifWidth")}
                    </span>
                    <div className="flex gap-1.5">
                      {GIF_WIDTH_PRESETS.map((preset) => (
                        <Button
                          key={preset}
                          type="button"
                          size="sm"
                          variant={maxWidth === preset ? "default" : "outline"}
                          className="h-7 px-2.5 text-xs"
                          onClick={() => setMaxWidth(preset)}
                          disabled={converting}
                        >
                          {preset}px
                        </Button>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <span className="text-xs text-muted-foreground">{t("guideEditor.gifFps")}</span>
                    <div className="flex gap-1.5">
                      {GIF_FPS_PRESETS.map((preset) => (
                        <Button
                          key={preset}
                          type="button"
                          size="sm"
                          variant={fps === preset ? "default" : "outline"}
                          className="h-7 px-2.5 text-xs"
                          onClick={() => setFps(preset)}
                          disabled={converting}
                        >
                          {preset}
                        </Button>
                      ))}
                    </div>
                  </div>
                </div>

                <p className="text-xs text-muted-foreground">
                  {t("guideEditor.gifEstimate", {
                    length: clipLength.toFixed(1),
                    frames: frameCount,
                  })}
                </p>
              </>
            )}

            {converting && (
              <div className="space-y-1.5">
                <Progress value={progress} />
                <p className="text-center text-xs text-muted-foreground">
                  {t("guideEditor.gifConverting", { percent: progress })}
                </p>
              </div>
            )}
          </div>
        )}

        {error && (
          <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>
        )}

        <DialogFooter className="sm:justify-between">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => inputRef.current?.click()}
            disabled={converting || !objectUrl}
          >
            {t("guideEditor.gifChangeVideo")}
          </Button>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
              disabled={converting}
            >
              {t("guideEditor.cropCancel")}
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={convert}
              disabled={converting || duration === null || clipLength <= 0}
            >
              {converting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {t("guideEditor.gifConvert")}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
