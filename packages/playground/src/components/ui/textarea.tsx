import * as React from "react"

import { cn } from "@/lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "border-input placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:bg-input/30 field-sizing-content min-h-16 w-full rounded-md border bg-transparent px-3 py-2 text-base shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        // When used in InputGroup, w-full will be overridden by !w-auto
        // Убеждаемся, что placeholder центрирован вертикально
        // Используем leading-6 для правильной высоты строки
        "leading-6",
        // Prevent text overflow - break long words
        "break-words",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
