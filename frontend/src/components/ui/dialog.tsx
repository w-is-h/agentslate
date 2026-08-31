/* shadcn dialog, wearing the app's modal shell — the one that was copied by
   hand into six places before. The mobile lessons are baked in here so no
   call site can lose them: min-w-0 on the card (unbreakable content otherwise
   inflates a centered modal past the viewport, and fixed elements never make
   a scrollbar to show it), and dvh rather than vh (vh lies under phone
   chrome). Sites set a max-width and fill in header / body / footer. */

import * as React from "react"
import { Dialog as DialogPrimitive } from "radix-ui"
import { X } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

const Dialog = DialogPrimitive.Root
const DialogPortal = DialogPrimitive.Portal
const DialogClose = DialogPrimitive.Close

function DialogOverlay({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        "fixed inset-0 z-90 bg-overlay duration-150 supports-backdrop-filter:backdrop-blur-[3px]",
        "data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
        className
      )}
      {...props}
    />
  )
}

function DialogContent({ className, children, ...props }: React.ComponentProps<typeof DialogPrimitive.Content>) {
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        aria-describedby={undefined}
        tabIndex={-1}
        /* focus the card, not the first control — otherwise every dialog
           opens with a focus ring drawn around its close × */
        onOpenAutoFocus={e => { e.preventDefault(); (e.currentTarget as HTMLElement).focus(); }}
        className={cn(
          "fixed top-1/2 left-1/2 z-100 flex w-[calc(100%-5.5rem)] max-w-[640px] min-w-0 max-h-[calc(100dvh-5.5rem)]",
          "-translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-line bg-raise",
          "shadow-pop duration-150 outline-none",
          "max-[640px]:w-[calc(100%-1.75rem)] max-[640px]:max-h-[calc(100dvh-1.75rem)]",
          "data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
          className
        )}
        {...props}
      >
        {children}
      </DialogPrimitive.Content>
    </DialogPortal>
  )
}

/* the header bar: title, then whatever else, then the close × at the end */
function DialogHeader({ className, children, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-none items-baseline gap-3.5 border-b border-line-soft px-6.5 py-3.5 max-[640px]:px-4", className)}
      {...props}
    >
      {children}
      <DialogClose asChild>
        <Button variant="ghost" size="none" className="self-center" title="close">
          <X size={17} />
          <span className="sr-only">close</span>
        </Button>
      </DialogClose>
    </div>
  )
}

function DialogBody({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-body"
      className={cn("min-h-0 overflow-y-auto px-6.5 py-5 max-[640px]:px-4", className)}
      {...props}
    />
  )
}

function DialogTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("font-mono text-sm font-medium whitespace-nowrap text-gold", className)}
      {...props}
    />
  )
}

export {
  Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle,
}
