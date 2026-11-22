import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from "lucide-react"
import * as React from "react"
import { useTheme } from "next-themes"
import { Toaster as Sonner, type ToasterProps } from "sonner"

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()
  // sonner は light/dark/system のみ対応。ウルトラダークは dark 扱いにする。
  const sonnerTheme = theme === "ultra-dark" ? "dark" : theme
  // md 未満は画面下寄せ（親指の届く位置。操作を含むトーストが上端に出ない）にして、
  // 下端固定の UI（ドック・Cookie バナー・保存バー）の分だけ持ち上げる（ui.md 10 章）。
  // トーストは操作後にしか出ないので、マウント後に切り替えてよい（SSR の描画に影響しない）。
  const [isMobile, setIsMobile] = React.useState(false)
  React.useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)")
    const update = () => setIsMobile(mq.matches)
    update()
    mq.addEventListener("change", update)
    return () => mq.removeEventListener("change", update)
  }, [])
  const mobileBottom = {
    bottom: "calc(1rem + var(--bottom-fixed-inset, 0px))",
    left: "1rem",
    right: "1rem",
  }

  return (
    <Sonner
      theme={sonnerTheme as ToasterProps["theme"]}
      className="toaster group"
      position={isMobile ? "bottom-center" : "top-right"}
      offset={isMobile ? mobileBottom : undefined}
      mobileOffset={mobileBottom}
      toastOptions={{
        classNames: {
          // 取消などの操作ボタン。md 未満（下寄せの判定と同じ境）は 44px（sonner 既定の 24px を上書き）
          actionButton: "max-md:h-11! max-md:min-h-11! max-md:px-4!",
          cancelButton: "max-md:h-11! max-md:min-h-11! max-md:px-4!",
        },
      }}
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
