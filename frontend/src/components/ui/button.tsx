/* shadcn button, tuned to the app's button language: outlined actions,
   quiet text actions, and ghost icon buttons. */

import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg border border-transparent whitespace-nowrap transition-all outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-45 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        outline: "border-line bg-transparent text-dim hover:bg-hover hover:text-ink",
        ghost: "text-faint hover:bg-hover hover:text-gold",
        /* the small mono action that sits inline in a header or a footer */
        quiet: "font-mono text-faint hover:text-ink",
      },
      size: {
        sm: "h-8 rounded-md px-3 text-[13px]",
        "icon-sm": "size-7 rounded-md",
        /* no box at all — the button is its text */
        none: "h-auto rounded-none p-0",
      },
    },
    defaultVariants: { variant: "outline", size: "sm" },
  }
)

function Button({
  className,
  variant = "outline",
  size = "sm",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "button"
  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button }
