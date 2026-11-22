import * as React from "react"

import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "file:text-foreground placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground border-muted-foreground/70 h-9 max-sm:min-h-11 w-full min-w-0 rounded-md border bg-input px-3 py-1 text-base shadow-xs transition-all duration-200 outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:cursor-pointer disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        "hover:border-ring/50",
        "focus-visible:border-ring focus-visible:ring-ring focus-visible:ring-2",
        "aria-invalid:border-destructive aria-invalid:focus-visible:ring-destructive",
        className
      )}
      {...props}
    />
  )
}

export { Input }
