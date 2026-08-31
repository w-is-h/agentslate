/* shadcn input in the app's control look: raised ground, a hairline border
   that warms to gold on focus. CONTROL is the whole form-control language —
   the textarea next door wears the same one, and so does anything that has
   to be an input by hand. */

import * as React from "react"

import { cn } from "@/lib/utils"

const CONTROL =
  "w-full rounded-lg border border-line bg-raise px-3.5 py-2 text-[16px] text-ink " +
  "placeholder:text-faint focus:border-gold-dim focus:outline-none disabled:opacity-50"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return <input type={type} data-slot="input" className={cn(CONTROL, className)} {...props} />
}

export { Input }
