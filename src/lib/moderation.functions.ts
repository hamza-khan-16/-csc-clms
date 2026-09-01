/**
 * moderation.functions.ts
 *
 * Two separate server-side AI integrations:
 *
 *  moderateText — uses Groq with fallback chain
 *    Primary:  openai/gpt-oss-safeguard-20b  (purpose-built safety classifier — ideal for moderation)
 *    Fallback: openai/gpt-oss-20b            (fast, capable general model)
 *    Fallback: groq/compound-mini            (lightweight Groq-native model)
 *    All models return a single word verdict so latency stays minimal.
 *    Fails open (returns CLEAN) if every model fails — never blocks the user.
 *
 *  leaveBotChat — uses Gemini (unchanged)
 *    Gemini handles the full chatbot conversation; it has a larger context window
 *    and is well-suited for multi-turn dialogue. Keep GEMINI_API_KEY for this.
 */

import { createServerFn } from "@tanstack/react-start";

// ── Groq (text moderation only) ───────────────────────────────────────────────
const GROQ_API = "https://api.groq.com/openai/v1/chat/completions";

// Tried in order — first success wins.
// IDs sourced directly from your account's live /v1/models response.
const GROQ_MODERATION_MODELS = [
  "openai/gpt-oss-safeguard-20b", // primary — purpose-built safety classifier, perfect for moderation
  "openai/gpt-oss-20b",           // fallback — fast general model, 131K context
  "groq/compound-mini",           // last resort — lightweight Groq-native model
];

// ── Gemini (chatbot only) ─────────────────────────────────────────────────────
const GEMINI_API = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
// Tried in order — first success wins.
const GEMINI_CHAT_MODELS = [
  "gemini-3.5-flash",      // primary (stable, free tier)
  "gemini-2.5-flash",      // capable fallback
  "gemini-2.5-flash-lite", // lighter fallback
  "gemini-3.5-flash-lite", // last resort — fastest, always on free tier
];

export type ModerationVerdict = "CLEAN" | "ABUSIVE" | "UNCLEAR";

// ── Text moderation (Groq / Llama fallback chain) ─────────────────────────────
export const moderateText = createServerFn({ method: "POST" })
  .inputValidator((data: { text: string }) => ({
    text: String(data?.text ?? "").slice(0, 500),
  }))
  .handler(async ({ data }): Promise<{ verdict: ModerationVerdict }> => {
    const key = process.env.GROQ_API_KEY;
    if (!key) return { verdict: "CLEAN" };

    const prompt = `You are a strict content moderator for a school/college leave management system.
Classify the following user-submitted text as exactly one of: CLEAN, ABUSIVE, or UNCLEAR.

Rules:
- ABUSIVE: contains profanity, slurs, hate speech, sexual language, threats, insults, or gibberish/random characters in ANY language (including English, Hindi, Hinglish, or romanised/transliterated scripts). Also flag random keyboard-mashing like "asdfghjkl" or "qwerty1234" as ABUSIVE.
- CLEAN: professional, neutral, or polite text appropriate for a workplace leave form.
- UNCLEAR: genuinely ambiguous — borderline content that could be either.

Respond with ONLY the single word verdict (CLEAN, ABUSIVE, or UNCLEAR). No explanation, no punctuation.

Text: """${data.text}"""`;

    for (const model of GROQ_MODERATION_MODELS) {
      try {
        const res = await fetch(GROQ_API, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
          body: JSON.stringify({
            model,
            max_tokens: 100,
            temperature: 0,
            messages: [{ role: "user", content: prompt }],
          }),
        });
        if (!res.ok) {
          console.warn(`[moderateText] model ${model} failed (${res.status}) — trying next`);
          continue; // try next model on rate limit (429), 404, 5xx, etc.
        }
        const json = await res.json() as { choices?: { message?: { content?: string; reasoning_content?: string } }[] };
        console.warn(`[moderateText] raw response from ${model}:`, JSON.stringify(json?.choices?.[0]?.message));
        const raw = (json?.choices?.[0]?.message?.content ?? "").trim().toUpperCase();
        if (!raw) {
          console.warn(`[moderateText] model ${model} returned empty — trying next`);
          continue;
        }
        if (raw.startsWith("ABUSIVE")) return { verdict: "ABUSIVE" };
        if (raw.startsWith("UNCLEAR")) return { verdict: "UNCLEAR" };
        return { verdict: "CLEAN" };
      } catch (err) {
        console.warn(`[moderateText] model ${model} threw — trying next`, err);
        continue;
      }
    }
    // All models exhausted — fail open so users are never blocked by an outage
    console.warn("[moderateText] all Groq models exhausted — failing open");
    return { verdict: "CLEAN" };
  });

// ── LeaveBot chat (Gemini — unchanged) ───────────────────────────────────────
interface ChatMessage { role: "user" | "assistant"; content: string; }

export const leaveBotChat = createServerFn({ method: "POST" })
  .inputValidator((data: { messages: ChatMessage[]; systemPrompt: string }) => ({
    messages: (data?.messages ?? []).slice(-20) as ChatMessage[], // last 20 messages max
    systemPrompt: String(data?.systemPrompt ?? "").slice(0, 80000),
  }))
  .handler(async ({ data }): Promise<{ reply: string }> => {
    const key = process.env.GEMINI_API_KEY;
    if (!key) return { reply: "LeaveBot is not configured yet. Please ask your admin to add the GEMINI_API_KEY to the server environment." };

    for (const model of GEMINI_CHAT_MODELS) {
      try {
        const res = await fetch(GEMINI_API, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
          body: JSON.stringify({
            model,
            max_tokens: 1024,
            temperature: 0.3,
            messages: [
              { role: "system", content: data.systemPrompt },
              ...data.messages.map((m) => ({ role: m.role, content: m.content })),
            ],
          }),
        });
        if (!res.ok) {
          console.warn(`[leaveBotChat] model ${model} failed (${res.status}) — trying next`);
          continue;
        }
        const json = await res.json() as { choices?: { message?: { content?: string } }[] };
        const reply = json?.choices?.[0]?.message?.content?.trim();
        if (!reply) {
          console.warn(`[leaveBotChat] model ${model} returned empty reply — trying next`);
          continue;
        }
        return { reply };
      } catch (err) {
        console.warn(`[leaveBotChat] model ${model} threw — trying next`, err);
        continue;
      }
    }
    // All models exhausted — graceful fallback
    return { reply: "I'm having trouble reaching the server right now. Please try again in a moment — your question hasn't been lost." };
  });