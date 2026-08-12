/**
 * GuardedField.tsx
 *
 * Drop-in wrappers around <Input> and <Textarea> that automatically run
 * the two-layer content moderation check (local blocklist + Groq LLM).
 *
 * Usage — GuardedInput:
 *   <GuardedInput
 *     fieldName="Reason"
 *     value={reason}
 *     onChange={(v) => setReason(v)}
 *     onGuardError={(err) => setHasError(!!err)}   // optional
 *     placeholder="Enter reason…"
 *   />
 *
 * Usage — GuardedTextarea:
 *   <GuardedTextarea
 *     fieldName="Note"
 *     value={note}
 *     onChange={(v) => setNote(v)}
 *     rows={3}
 *   />
 *
 * Both components forward all standard HTML props (except onChange which
 * is adapted to return the string value directly for convenience).
 *
 * The `onGuardError` callback fires whenever the error state changes — use
 * it to disable a submit button in the parent:
 *   const [blocked, setBlocked] = useState(false);
 *   ...
 *   <Button disabled={blocked}>Submit</Button>
 */

import { useId, forwardRef } from "react";
import { Loader2 } from "lucide-react";
import { Input }    from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useTextGuard } from "@/lib/textGuard";
import { cn } from "@/lib/utils";

// ── shared props ──────────────────────────────────────────────────────────────
interface GuardProps {
  fieldName?: string;
  value: string;
  onChange: (value: string) => void;
  onGuardError?: (error: string | null) => void;
  className?: string;
}

// ── error + spinner row displayed below the field ─────────────────────────────
function GuardFeedback({ error, checking }: { error: string | null; checking: boolean }) {
  if (!error && !checking) return null;
  return (
    <p className={cn("flex items-center gap-1 text-xs mt-1", error ? "text-destructive" : "text-muted-foreground")}>
      {checking && !error && <Loader2 className="h-3 w-3 animate-spin" />}
      {checking && !error && "Checking…"}
      {error && <span>⚠ {error}</span>}
    </p>
  );
}

// ── GuardedInput ──────────────────────────────────────────────────────────────
type InputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange" | "value">;

export const GuardedInput = forwardRef<HTMLInputElement, GuardProps & InputProps>(
  ({ fieldName = "Field", value, onChange, onGuardError, className, ...rest }, ref) => {
    const { error, checking } = useTextGuard(value, fieldName);

    // Fire parent callback when guard state changes
    const prevErrorRef = { current: error };
    if (prevErrorRef.current !== error) onGuardError?.(error);

    return (
      <div className="w-full">
        <Input
          ref={ref}
          value={value}
          onChange={(e) => onChange(e.target.value)}
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

export const GuardedTextarea = forwardRef<HTMLTextAreaElement, GuardProps & TextareaProps>(
  ({ fieldName = "Field", value, onChange, onGuardError, className, ...rest }, ref) => {
    const { error, checking } = useTextGuard(value, fieldName);

    const prevErrorRef = { current: error };
    if (prevErrorRef.current !== error) onGuardError?.(error);

    return (
      <div className="w-full">
        <Textarea
          ref={ref}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={cn(error ? "border-destructive focus-visible:ring-destructive" : "", className)}
          {...rest}
        />
        <GuardFeedback error={error} checking={checking} />
      </div>
    );
  },
);
GuardedTextarea.displayName = "GuardedTextarea";
