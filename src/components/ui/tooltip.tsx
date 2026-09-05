"use client";

import * as React from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";

import { cn } from "@/lib/utils";

// Pre-configured provider — 400ms delay, instant close, no skipping on hover
const TooltipProvider = ({ delayDuration = 400, skipDelayDuration = 0, ...props }: React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Provider>) => (
  <TooltipPrimitive.Provider delayDuration={delayDuration} skipDelayDuration={skipDelayDuration} {...props} />
);

const Tooltip = TooltipPrimitive.Root;

const TooltipTrigger = TooltipPrimitive.Trigger;

const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 6, children, ...props }, ref) => (
  <TooltipPrimitive.Portal>
    <TooltipPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        // Dark neutral pill — matches Claude.ai tooltip style
        "z-50 overflow-hidden rounded-lg bg-neutral-900 dark:bg-neutral-100 px-2.5 py-1.5",
        "text-[11px] font-medium leading-none text-neutral-50 dark:text-neutral-900",
        "shadow-lg shadow-black/20",
        // Animations
        "animate-in fade-in-0 zoom-in-95",
        "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
        "data-[side=bottom]:slide-in-from-top-1 data-[side=left]:slide-in-from-right-1",
        "data-[side=right]:slide-in-from-left-1 data-[side=top]:slide-in-from-bottom-1",
        "origin-(--radix-tooltip-content-transform-origin)",
        className,
      )}
      {...props}
    >
      {children}
      <TooltipPrimitive.Arrow className="fill-neutral-900 dark:fill-neutral-100" width={10} height={5} />
    </TooltipPrimitive.Content>
  </TooltipPrimitive.Portal>
));
TooltipContent.displayName = TooltipPrimitive.Content.displayName;

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider };