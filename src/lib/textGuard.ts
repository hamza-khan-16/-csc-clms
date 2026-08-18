/**
 * textGuard.ts
 *
 * Two-layer content moderation for Input / Textarea fields:
 *
 *  Layer 1 — Instant local blocklist (no network)
 *    A curated set of common English + Hindi abusive / profane words.
 *    Catches the obvious cases immediately (zero latency).
 *
 *  Layer 2 — Groq LLM (llama-3.1-8b-instant, free tier)
 *    Called after the user stops typing for 800 ms. Returns a short verdict
 *    so the model can't be tricked into explaining or reproducing the content.
 *
 * Usage:
 *   const { error, checking } = useTextGuard(value, "Reason");
 *   // Show `error` as inline red text. Block form submit when error !== null.
 *
 * Setup:
 *   Add VITE_GROQ_API_KEY=<your_key> to .env
 *   Get a free key at https://console.groq.com (no credit card required)
 */

import { useState, useEffect, useRef } from "react";
import { validateMeaningfulText } from "@/lib/validateText";

// ── Layer 1: local word blocklist ─────────────────────────────────────────────
// Words are stored as substrings; we check if any appears in the normalised text.
const BLOCKED_SUBSTRINGS = [
  // Common English profanity / slurs (abbreviated to avoid storing them verbatim)
  "fuck","shit","bitch","asshole","bastard","cunt","dick","cock","pussy",
  "whore","slut","faggot","nigger","retard","motherfuck","bullshit",
  "jackass","dumbass","idiot","moron","stupid","loser","screw you",
  "go to hell","son of a bitch","shut up","shut the",
  // Hindi / Hinglish abusive words (romanised common spellings)
  "madarchod","bhosdike","bhosdi","chutiya","chutiye","gaandu","gandu",
  "harami","haraami","randi","bhen ke","bhenke","teri maa","teri ma",
  "teri behen","teri behan","sala","saala","saali","sali","kamina",
  "kamine","kutte","kuttiya","suar","suwar","ullu","bakwaas","gadha",
  "gadhe","gaddha","hijra","hijda","lavde","lavda","lund","lunde",
  "lauda","laude","bhad mein jao","jao bhosdike","maa ki aankh",
  "maa ki","baap ka","tere baap","teri gaand","gaand","gaandmasti",
  "bsdk","mcd","bc","mc","lc","bkl","bhk",
];

/** Returns the matched blocked word if found, else null */
export function localBlocklistCheck(text: string): string | null {
  const normalised = text.toLowerCase().replace(/[\s\-_]+/g, "");
  for (const sub of BLOCKED_SUBSTRINGS) {
    const normSub = sub.toLowerCase().replace(/[\s\-_]+/g, "");
    if (normalised.includes(normSub)) return sub;
  }
  return null;
}

/** One-shot moderation check — returns true if the text is abusive. Used for chat input on send. */
export async function groqModerationCheck(text: string): Promise<boolean> {
  const verdict = await groqCheck(text);
  return verdict === "ABUSIVE";
}

// ── Layer 2: Groq LLM check ───────────────────────────────────────────────────
const GROQ_API = "https://api.groq.com/openai/v1/chat/completions";
const MODEL    = "openai/gpt-oss-120b";

type GroqVerdict = "CLEAN" | "ABUSIVE" | "UNCLEAR";

async function groqCheck(text: string): Promise<GroqVerdict> {
  const key = import.meta.env.VITE_GROQ_API_KEY;
  if (!key) return "CLEAN"; // no key configured — skip silently

  const prompt = `You are a strict content moderator for a school/college leave management system.
Classify the following text as exactly one of: CLEAN, ABUSIVE, or UNCLEAR.

Rules:
- ABUSIVE: contains profanity, slurs, hate speech, sexual language, threats, or insults in ANY language (including English, Hindi, Hinglish, or transliterated scripts).
- CLEAN: professional, neutral, or polite text appropriate for a workplace form.
- UNCLEAR: genuinely ambiguous — could be either.

Respond with ONLY the single word verdict. No explanation.

Text: """${text.slice(0, 400)}"""`;

  try {
    const res = await fetch(GROQ_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 5,
        temperature: 0,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!res.ok) return "CLEAN"; // fail open — don't block on API errors
    const data = await res.json();
    const raw = (data?.choices?.[0]?.message?.content ?? "").trim().toUpperCase();
    if (raw.startsWith("ABUSIVE")) return "ABUSIVE";
    if (raw.startsWith("UNCLEAR")) return "UNCLEAR";
    return "CLEAN";
  } catch {
    return "CLEAN"; // network error → fail open
  }
}

// ── React hook ────────────────────────────────────────────────────────────────
export interface TextGuardResult {
  /** Non-null = show as inline error and block submit */
  error: string | null;
  /** True while the LLM call is in flight */
  checking: boolean;
}

const DEBOUNCE_MS = 600; // ms after typing stops before LLM fires

/**
 * useTextGuard(value, fieldName)
 *
 * Three-layer guard — fires on every keystroke, no minimum length:
 *   Layer 1a: local abusive word blocklist (instant, substring match)
 *   Layer 1b: gibberish / nonsense check (instant, once ≥ 6 chars)
 *   Layer 2:  Groq LLM moderation (debounced 600 ms after typing stops,
 *             only on text that passed layers 1a/1b)
 *
 * Key behaviours:
 *  - A previous error is NEVER cleared just because the user typed one
 *    more character — it only clears when the new text is explicitly clean.
 *  - Abusive prefixes ("fu", "fuc", "fuck") are caught as soon as the
 *    blocked substring appears in the normalised text.
 *  - The LLM is not called while layer-1 errors are present.
 */
export function useTextGuard(value: string, fieldName = "Text"): TextGuardResult {
  const [error,    setError]    = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const timerRef       = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastCheckedRef = useRef<string>("");
  const llmErrorRef    = useRef<string | null>(null); // last verdict from LLM

  useEffect(() => {
    const trimmed = value.trim();

    // ── Empty / very short ────────────────────────────────────────────────
    if (trimmed.length === 0) {
      if (timerRef.current) clearTimeout(timerRef.current);
      setChecking(false);
      setError(null);
      llmErrorRef.current = null;
      lastCheckedRef.current = "";
      return;
    }

    // ── Layer 1a: abusive word blocklist (every keystroke, no min length) ─
    const blocked = localBlocklistCheck(trimmed);
    if (blocked) {
      if (timerRef.current) clearTimeout(timerRef.current);
      setChecking(false);
      llmErrorRef.current = null;
      setError(`${fieldName} contains inappropriate language. Please use professional wording.`);
      return;
    }

    // ── Layer 1b: gibberish check (once ≥ 6 chars so partial words are ok) ─
    if (trimmed.length >= 6) {
      const meaningful = validateMeaningfulText(trimmed, fieldName);
      if (!meaningful.valid) {
        if (timerRef.current) clearTimeout(timerRef.current);
        setChecking(false);
        llmErrorRef.current = null;
        setError(meaningful.error ?? `${fieldName} appears to contain random characters. Please write meaningful text.`);
        return;
      }
    }

    // ── Layers 1a + 1b passed — show LLM error from previous check if still
    //    relevant (don't wipe it just because one more char was typed) ──────
    if (llmErrorRef.current) {
      setError(llmErrorRef.current);
    } else {
      setError(null);
    }

    // ── Layer 2: LLM check (debounced, skipped if nothing changed) ─────────
    if (timerRef.current) clearTimeout(timerRef.current);
    if (trimmed === lastCheckedRef.current) return;

    timerRef.current = setTimeout(async () => {
      lastCheckedRef.current = trimmed;
      setChecking(true);
      const verdict = await groqCheck(trimmed);
      setChecking(false);

      if (verdict === "ABUSIVE") {
        llmErrorRef.current = `${fieldName} contains inappropriate language. Please use professional wording.`;
      } else if (verdict === "UNCLEAR") {
        llmErrorRef.current = `${fieldName} may contain inappropriate content. Please review your wording.`;
      } else {
        llmErrorRef.current = null;
      }
      setError(llmErrorRef.current);
    }, DEBOUNCE_MS);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [value, fieldName]);

  return { error, checking };
}