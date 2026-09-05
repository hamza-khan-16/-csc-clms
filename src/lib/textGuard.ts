/**
 * textGuard.ts
 *
 * Two-layer content moderation for Input / Textarea fields:
 *
 *  Layer 1 — Instant local blocklist (no network)
 *    A curated set of common English + Hindi abusive / profane words.
 *    Catches the obvious cases immediately (zero latency).
 *    Normalises leetspeak (4→a, 3→e, 0→o, 1→i, @→a, $→s, 5→s)
 *    and strips all non-alphanumeric characters so spacing/punctuation
 *    tricks (e.g. "f.u.c.k", "f u c k", "sh!t") are caught.
 *    Short abbreviations (bc, mc, lc) use whole-word matching only
 *    so they don't fire inside legitimate words like "because".
 *
 *  Layer 2 — Groq LLM (llama-3.1-8b-instant, free tier)
 *    Called after the user stops typing for 800 ms. Returns a short verdict
 *    so the model can't be tricked into explaining or reproducing the content.
 *
 * Setup:
 *   Add GROQ_API_KEY=<your_key> to your SERVER environment (Vercel env vars)
 *   Do NOT use VITE_GROQ_API_KEY — that would expose the key in the client bundle
 *   Get a free key at https://console.groq.com (no credit card required)
 */

import { useState, useEffect, useRef } from "react";
import { useServerFn } from "@tanstack/react-start";
import { validateMeaningfulText } from "@/lib/validateText";
import { moderateText } from "@/lib/moderation.functions";

// ── Normalisation ─────────────────────────────────────────────────────────────
// Strip ALL non-letter characters and apply common substitutions so tricks
// like "f.u.c.k", "f u c k", "sh!t", "a$$", "4ss", "@ss" are caught.
const LEET: Record<string, string> = {
  "0": "o", "1": "i", "3": "e", "4": "a", "5": "s",
  "6": "g", "7": "t", "8": "b", "9": "g",
  "@": "a", "$": "s", "!": "i", "+": "t", "(": "c",
};

function normalise(text: string): string {
  return text
    .toLowerCase()
    .split("")
    .map((c) => LEET[c] ?? c)
    .join("")
    .replace(/[^a-z]/g, ""); // strip everything non-alpha after substitution
}

// ── Layer 1: local word blocklist ─────────────────────────────────────────────
// Two buckets:
//   BLOCKED_SUBSTRINGS  — checked as substrings in the fully normalised text
//   BLOCKED_WHOLE_WORDS — checked as whole words only (for short abbrevs that
//                         would false-positive inside real words)

const BLOCKED_SUBSTRINGS = [
  // English profanity
  "fuck", "shit", "bitch", "asshole", "bastard", "cunt", "dick", "cock",
  "pussy", "whore", "slut", "faggot", "nigger", "retard", "motherfuck",
  "bullshit", "jackass", "dumbass", "idiot", "moron", "loser",
  "screwu", "gotohell", "sonofabitch", "shutthefuck",
  // Hindi / Hinglish (romanised)
  "madarchod", "bhosdike", "bhosdi", "chutiya", "chutiye", "gaandu", "gandu",
  "harami", "haraami", "randi", "bhenke", "terimaa", "terima",
  "teribehen", "teribehan", "kamina", "kamine", "kutte", "kuttiya",
  "suar", "suwar", "ullu", "bakwaas", "gadha", "gadhe", "gaddha",
  "hijra", "hijda", "lavde", "lavda", "lund", "lunde", "lauda", "laude",
  "bhadmeinjao", "jaobhosdike", "maakiaankh", "maaki",
  "baapka", "terebaap", "teriaaand", "gaand", "gaandmasti",
  "saala", "saali", "sala", "sali",
  // Common abbreviation spellings typed in full
  "bsdk", "mcd",
];

// Short tokens checked only as whole words (split on whitespace + punctuation)
// so "bc" doesn't block "because", "mc" doesn't block "McGregor"
const BLOCKED_WHOLE_WORDS = new Set(["bc", "mc", "lc", "bkl", "bhk"]);

/** Splits the raw text into lowercase tokens for whole-word checks */
function rawTokens(text: string): string[] {
  return text.toLowerCase().split(/[\s\-_.,;:!?()/\\]+/).filter(Boolean);
}

/** Returns the matched blocked word if found, else null */
export function localBlocklistCheck(text: string): string | null {
  const norm = normalise(text);

  // Substring check (normalised — catches leetspeak and spacing tricks)
  for (const sub of BLOCKED_SUBSTRINGS) {
    if (norm.includes(sub)) return sub;
  }

  // Whole-word check (on raw tokens — avoids false positives for short abbrevs)
  const tokens = rawTokens(text);
  for (const tok of tokens) {
    if (BLOCKED_WHOLE_WORDS.has(tok)) return tok;
  }

  return null;
}

/** One-shot moderation check — returns true if the text is abusive. */
export async function groqModerationCheck(text: string): Promise<boolean> {
  try {
    const { verdict } = await moderateText({ data: { text } });
    return verdict === "ABUSIVE";
  } catch {
    return false;
  }
}

// ── Layer 2: server-side Groq check ──────────────────────────────────────────
// groqCheck is now a thin wrapper — actual fetch happens in moderation.functions.ts
// on the server, which fixes both CORS and API key exposure.
type GroqVerdict = "CLEAN" | "ABUSIVE" | "UNCLEAR";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function groqCheck(text: string, serverFn: any): Promise<GroqVerdict> {
  try {
    const { verdict } = await serverFn({ data: { text } });
    return verdict;
  } catch {
    return "CLEAN"; // fail open on any error
  }
}

// ── React hook ────────────────────────────────────────────────────────────────
export interface TextGuardResult {
  /** Non-null = show as inline error and block submit */
  error: string | null;
  /** True while the LLM call is in flight */
  checking: boolean;
  /**
   * Call this before submitting a form.
   * Runs layers 1a + 1b synchronously and awaits any in-flight LLM check.
   * Returns null if clean, or an error string to show and block submit with.
   */
  validateNow: () => Promise<string | null>;
}

const DEBOUNCE_MS = 600;

/**
 * useTextGuard(value, fieldName)
 *
 * Three-layer guard:
 *   Layer 1a: local abusive word blocklist (instant, normalised substring match)
 *   Layer 1b: gibberish / nonsense check (instant, once ≥ 6 chars)
 *   Layer 2:  Groq LLM moderation (debounced 600ms, only after layers 1a/1b pass)
 *
 * Key behaviours:
 *  - LLM is re-triggered whenever the text changes from the last checked value,
 *    including after the user edits previously flagged text.
 *  - A previous LLM error is only retained if the current text still matches
 *    what the LLM checked. Editing the text clears the stale verdict and
 *    schedules a fresh LLM check.
 *  - Short abbreviation blocklist uses whole-word matching only.
 */
export function useTextGuard(value: string, fieldName = "Text"): TextGuardResult {
  const [error,    setError]    = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const timerRef        = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastCheckedRef  = useRef<string>("");   // text that was last sent to LLM
  const llmErrorRef     = useRef<string | null>(null); // verdict for lastCheckedRef
  const mountedRef      = useRef(true);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const callModerate    = useServerFn(moderateText as any) as any;
  // Holds the in-flight LLM promise so validateNow() can await it on submit
  const pendingLLMRef   = useRef<Promise<GroqVerdict> | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    const trimmed = value.trim();

    // ── Empty ─────────────────────────────────────────────────────────────
    if (trimmed.length === 0) {
      setChecking(false);
      setError(null);
      llmErrorRef.current  = null;
      lastCheckedRef.current = "";
      return;
    }

    // ── Layer 1a: abusive blocklist — check on every keystroke ───────────────
    const blocked = localBlocklistCheck(trimmed);
    if (blocked) {
      setChecking(false);
      llmErrorRef.current = null;
      lastCheckedRef.current = "";
      setError(`${fieldName} contains inappropriate language. Please use professional wording.`);
      return;
    }

    // ── Layer 1b: gibberish check — start at 3 chars ──────────────────────
    if (trimmed.length >= 3) {
      const meaningful = validateMeaningfulText(trimmed, fieldName);
      if (!meaningful.valid) {
        setChecking(false);
        llmErrorRef.current = null;
        lastCheckedRef.current = "";
        setError(meaningful.error ?? `${fieldName} appears to contain random characters. Please write meaningful text.`);
        return;
      }
    }

    // ── Retain LLM verdict only if it was for the exact same text ─────────
    // If the user edited the text, clear the old verdict so a stale error
    // is never shown for content that has since changed.
    if (trimmed !== lastCheckedRef.current) {
      llmErrorRef.current = null;
    }
    setError(llmErrorRef.current);

    // ── Layer 2: Groq LLM (debounced) ────────────────────────────────────
    // Skip if the text hasn't changed since the last LLM call
    if (trimmed === lastCheckedRef.current) return;

    timerRef.current = setTimeout(() => {
      if (!mountedRef.current) return;
      lastCheckedRef.current = trimmed;
      setChecking(true);

      // Store the promise so validateNow() can await it if submit fires mid-check
      const llmPromise = groqCheck(trimmed, callModerate);
      pendingLLMRef.current = llmPromise;

      llmPromise.then((verdict) => {
        if (!mountedRef.current) return;
        pendingLLMRef.current = null;
        setChecking(false);

        if (verdict === "ABUSIVE") {
          llmErrorRef.current = `${fieldName} contains inappropriate language. Please use professional wording.`;
        } else if (verdict === "UNCLEAR") {
          llmErrorRef.current = `${fieldName} may contain inappropriate content. Please review your wording.`;
        } else {
          llmErrorRef.current = null;
        }

        // Only apply if the text hasn't changed while we were waiting
        if (value.trim() === lastCheckedRef.current && mountedRef.current) {
          setError(llmErrorRef.current);
        }
      });
    }, DEBOUNCE_MS);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [value, fieldName, callModerate]);

  /**
   * validateNow — call this before submitting.
   * 1. Instantly re-runs blocklist + gibberish on current value.
   * 2. If the LLM is still in-flight, awaits it.
   * 3. If text hasn't been LLM-checked yet, fires a fresh check now.
   * Returns null if clean, or an error string to block submit with.
   */
  async function validateNow(): Promise<string | null> {
    const trimmed = value.trim();
    if (!trimmed) return null;

    // Layer 1a: blocklist
    const blocked = localBlocklistCheck(trimmed);
    if (blocked) {
      const msg = `${fieldName} contains inappropriate language. Please use professional wording.`;
      setError(msg);
      return msg;
    }

    // Layer 1b: gibberish (from 3 chars)
    if (trimmed.length >= 3) {
      const meaningful = validateMeaningfulText(trimmed, fieldName);
      if (!meaningful.valid) {
        const msg = meaningful.error ?? `${fieldName} appears to contain random characters.`;
        setError(msg);
        return msg;
      }
    }

    // Layer 2: await in-flight LLM check, or fire a fresh one if needed
    let verdict: GroqVerdict;
    if (pendingLLMRef.current) {
      // LLM is already running — await its result
      verdict = await pendingLLMRef.current;
    } else if (trimmed !== lastCheckedRef.current) {
      // Text hasn't been checked yet (e.g. user submitted before debounce fired)
      if (timerRef.current) clearTimeout(timerRef.current);
      setChecking(true);
      lastCheckedRef.current = trimmed;
      const p = groqCheck(trimmed, callModerate);
      pendingLLMRef.current = p;
      verdict = await p;
      pendingLLMRef.current = null;
      setChecking(false);
    } else {
      // Already checked and result is in llmErrorRef
      if (llmErrorRef.current) {
        setError(llmErrorRef.current);
        return llmErrorRef.current;
      }
      return null;
    }

    if (verdict === "ABUSIVE") {
      llmErrorRef.current = `${fieldName} contains inappropriate language. Please use professional wording.`;
    } else if (verdict === "UNCLEAR") {
      llmErrorRef.current = `${fieldName} may contain inappropriate content. Please review your wording.`;
    } else {
      llmErrorRef.current = null;
    }

    if (mountedRef.current) setError(llmErrorRef.current);
    return llmErrorRef.current;
  }

  return { error, checking, validateNow };
}
