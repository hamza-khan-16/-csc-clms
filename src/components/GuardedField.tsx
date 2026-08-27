/**
 * GuardedField.tsx
 *
 * Drop-in wrappers around <Input> and <Textarea> that automatically run
 * the two-layer content moderation check (local blocklist + Groq LLM).
 *
 * Usage — GuardedInput:
 *   const guardRef = useRef<GuardHandle>(null);
 *   ...
 *   <GuardedInput
 *     ref={guardRef}
 *     fieldName="Reason"
 *     value={reason}
 *     onChange={(v) => setReason(v)}
 *     placeholder="Enter reason…"
 *   />
 *   ...
 *   // In submit handler:
 *   const err = await guardRef.current?.validateNow();
 *   if (err) return; // already shown inline
 *
 * Usage — GuardedTextarea:
 *   <GuardedTextarea ref={guardRef} fieldName="Note" value={note} onChange={...} rows={3} />
 *
 * GuardHandle is exported so parents can type the ref correctly.
 */

import { useId, forwardRef, useEffect, useImperativeHandle } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { Input }    from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useTextGuard } from "@/lib/textGuard";
import { cn } from "@/lib/utils";

// ── Public handle exposed via ref ─────────────────────────────────────────────
export interface GuardHandle {
  /**
   * Run all three layers synchronously + await LLM.
   * Call this in your form's submit handler before proceeding.
   * Returns null if clean, or an error string (already shown inline).
   */
  validateNow: () => Promise<string | null>;
}

// ── Shared props ──────────────────────────────────────────────────────────────
interface GuardProps {
  fieldName?: string;
  value: string;
  onChange: (value: string) => void;
  onGuardError?: (error: string | null) => void;
  className?: string;
}

// ── Error + spinner row ───────────────────────────────────────────────────────
function GuardFeedback({ error, checking }: { error: string | null; checking: boolean }) {
  if (!error && !checking) return null;
  return (
    <p className={cn("flex items-center gap-1 text-xs mt-1", error ? "text-destructive" : "text-muted-foreground")}>
      {checking && !error && <Loader2 className="h-3 w-3 animate-spin" />}
      {checking && !error && "Checking…"}
      {error && <span className="inline-flex items-center gap-1"><AlertTriangle className="size-3.5 shrink-0"/>{error}</span>}
    </p>
  );
}

// ── GuardedInput ──────────────────────────────────────────────────────────────
type InputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange" | "value">;

export const GuardedInput = forwardRef<GuardHandle, GuardProps & InputProps>(
  ({ fieldName = "Field", value, onChange, onGuardError, className, ...rest }, ref) => {
    const { error, checking, validateNow } = useTextGuard(value, fieldName);

    useEffect(() => { onGuardError?.(error); }, [error, onGuardError]);

    // Expose validateNow to parent via ref
    useImperativeHandle(ref, () => ({ validateNow }), [validateNow]);

    return (
      <div className="w-full">
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={!!error}
          className={cn(error ? "border-destructive focus-visible:ring-destructive" : "", className)}
          {...rest}
        />
        <GuardFeedback error={error} checking={checking} />
      </div>
    );
  },
);
GuardedInput.displayName = "GuardedInput";

// ── GuardedTextarea ───────────────────────────────────────────────────────────
type TextareaProps = Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "onChange" | "value">;

export const GuardedTextarea = forwardRef<GuardHandle, GuardProps & TextareaProps>(
  ({ fieldName = "Field", value, onChange, onGuardError, className, ...rest }, ref) => {
    const { error, checking, validateNow } = useTextGuard(value, fieldName);

    useEffect(() => { onGuardError?.(error); }, [error, onGuardError]);

    useImperativeHandle(ref, () => ({ validateNow }), [validateNow]);

    return (
      <div className="w-full">
        <Textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={!!error}
          className={cn(error ? "border-destructive focus-visible:ring-destructive" : "", className)}
          {...rest}
        />
        <GuardFeedback error={error} checking={checking} />
      </div>
    );
  },
);
GuardedTextarea.displayName = "GuardedTextarea";
