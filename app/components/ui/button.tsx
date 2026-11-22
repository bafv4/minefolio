import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all duration-200 cursor-pointer disabled:pointer-events-none disabled:opacity-50 disabled:cursor-not-allowed [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:border-ring focus-visible:ring-ring focus-visible:ring-2 aria-invalid:border-destructive aria-invalid:focus-visible:ring-destructive active:scale-[0.98] motion-reduce:active:scale-100",
  {
    variants: {
      variant: {
        // 塗りの面と --ring が同系色でリングが面に溶けるため、背景色のすき間（offset）を挟んで背景に対して見せる
        default: "bg-brand text-brand-foreground shadow-sm hover:bg-brand/90 hover:shadow-md focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        destructive:
          "bg-destructive-fill text-white shadow-sm hover:bg-destructive/80 hover:shadow-md focus-visible:ring-destructive focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        outline:
          "border border-outline-border bg-outline-fill shadow-xs hover:bg-outline-fill-hover hover:text-accent-foreground hover:border-accent-foreground/20",
        secondary:
          "bg-secondary text-secondary-foreground shadow-xs hover:bg-secondary/70 hover:shadow-sm",
        ghost:
          "hover:bg-ghost-hover hover:text-accent-foreground",
        link: "text-brand-link underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2 has-[>svg]:px-3",
        sm: "h-8 rounded-md gap-1.5 px-3 has-[>svg]:px-2.5",
        lg: "h-10 rounded-md px-6 has-[>svg]:px-4",
        icon: "size-9",
        "icon-sm": "size-8",
        "icon-lg": "size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
