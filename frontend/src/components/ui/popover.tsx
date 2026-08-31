/* shadcn popover in the app's panel look: a raised card, hairline border,
   a real drop shadow. Sits under dialogs (z-90/100) in the stack. */

import * as React from "react"
import { Popover as PopoverPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

const Popover = PopoverPrimitive.Root
const PopoverTrigger = PopoverPrimitive.Trigger

/* the panel look, apart from Radix's own positioning/animation plumbing */
const POPOVER_PANEL = "rounded-xl border border-line bg-raise p-1.5 shadow-pop text-popover-foreground"

function PopoverContent({
  className, align = "center", sideOffset = 8, ...props
}: React.ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        data-slot="popover-content"
        align={align}
        sideOffset={sideOffset}
        className={cn(
          "z-80 w-72 max-w-[calc(100vw-1.5rem)] origin-(--radix-popover-content-transform-origin)",
          POPOVER_PANEL,
          "duration-150 outline-none",
          "data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2",
          "data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
          className
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  )
}

export { Popover, PopoverContent, PopoverTrigger }
