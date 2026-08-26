/**
 * moderation.functions.ts
 *
 * Server-side Gemini calls via createServerFn.
 * Running on the server solves two problems:
 *   1. CORS — Gemini blocks direct browser → API requests
 *   2. Key safety — GEMINI_API_KEY stays in the server env, never in the bundle
 *
 * Model fallback order (all free tier):
 *   gemini-3.5-flash → gemini-2.5-flash → gemini-2.5-flash-lite → gemini-3.5-flash-lite
 * Every non-OK status (rate limit, 404, 5xx) continues to the next model.
 * The conversation is never stopped mid-way due to a single model failing.
 */

import { createServerFn } from "@tanstack/react-start";

const GEMINI_API = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";

// Tried in order — first success wins. gemini-3.5-flash kept as primary per original intent.
const GEMINI_MODELS = [
  "gemini-3.5-flash",      // primary (stable, free tier)
  "gemini-2.5-flash",      // capable fallback (stable, free tier)
  "gemini-2.5-flash-lite", // lighter fallback (stable, free tier)
  "gemini-3.5-flash-lite", // last resort — fastest, always on free tier
];

export type ModerationVerdict = "CLEAN" | "ABUSIVE" | "UNCLEAR";

// ── Text moderation ───────────────────────────────────────────────────────────
export const moderateText = createServerFn({ method: "POST" })
  .inputValidator((data: { text: string }) => ({
    text: String(data?.text ?? "").slice(0, 500),
  }))
  .handler(async ({ data }): Promise<{ verdict: ModerationVerdict }> => {
    const key = process.env.GEMINI_API_KEY;
    if (!key) return { verdict: "CLEAN" };

    const prompt = `You are a strict content moderator for a school/college leave management system.
Classify the following user-submitted text as exactly one of: CLEAN, ABUSIVE, or UNCLEAR.

Rules:
- ABUSIVE: contains profanity, slurs, hate speech, sexual language, threats, insults, or gibberish/random characters in ANY language (including English, Hindi, Hinglish, or romanised/transliterated scripts). Also flag random keyboard-mashing like "asdfghjkl" or "qwerty1234" as ABUSIVE.
- CLEAN: professional, neutral, or polite text appropriate for a workplace leave form.
- UNCLEAR: genuinely ambiguous — borderline content that could be either.

Respond with ONLY the single word verdict (CLEAN, ABUSIVE, or UNCLEAR). No explanation, no punctuation.

Text: """${data.text}"""`;

    for (const model of GEMINI_MODELS) {
      try {
        const res = await fetch(GEMINI_API, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
          body: JSON.stringify({ model, max_tokens: 5, temperature: 0, messages: [{ role: "user", content: prompt }] }),
        });
        if (!res.ok) {
          console.warn(`[moderateText] model ${model} failed (${res.status}) — trying next`);
          continue; // try next model on ANY failure (404, 429, 500, etc.)
        }
        const json = await res.json() as { choices?: { message?: { content?: string } }[] };
        const raw = (json?.choices?.[0]?.message?.content ?? "").trim().toUpperCase();
        if (!raw) continue; // empty response — try next model
        if (raw.startsWith("ABUSIVE")) return { verdict: "ABUSIVE" };
        if (raw.startsWith("UNCLEAR")) return { verdict: "UNCLEAR" };
        return { verdict: "CLEAN" };
      } catch (err) {
        console.warn(`[moderateText] model ${model} threw — trying next`, err);
        continue;
      }
    }
    // All models failed — fail open (don't block the user)
    return { verdict: "CLEAN" };
  });

// ── LeaveBot chat ─────────────────────────────────────────────────────────────
interface ChatMessage { role: "user" | "assistant"; content: string; }

export const leaveBotChat = createServerFn({ method: "POST" })
  .inputValidator((data: { messages: ChatMessage[]; systemPrompt: string }) => ({
    messages: (data?.messages ?? []).slice(-20) as ChatMessage[], // last 20 messages max
    systemPrompt: String(data?.systemPrompt ?? "").slice(0, 80000),
  }))
  .handler(async ({ data }): Promise<{ reply: string }> => {
    const key = process.env.GEMINI_API_KEY;
    if (!key) return { reply: "LeaveBot is not configured yet. Please ask your admin to add the GEMINI_API_KEY to the server environment." };

    const CHAT_MODELS = [
      "gemini-3.5-flash",      // primary (stable, free tier)
      "gemini-2.5-flash",      // capable fallback (stable, free tier)
      "gemini-2.5-flash-lite", // lighter fallback (stable, free tier)
      "gemini-3.5-flash-lite", // last resort — fastest, always on free tier
    ];

    for (const model of CHAT_MODELS) {
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
          continue; // try next model on ANY failure (404, 429, 500, etc.)
        }
        const json = await res.json() as { choices?: { message?: { content?: string } }[] };
        const reply = json?.choices?.[0]?.message?.content?.trim();
        if (!reply) {
          console.warn(`[leaveBotChat] model ${model} returned empty reply — trying next`);
          continue; // empty reply — try next model
        }
        return { reply };
      } catch (err) {
        console.warn(`[leaveBotChat] model ${model} threw — trying next`, err);
        continue;
      }
    }
    // All models exhausted — still return a graceful message, never crash the chat
    return { reply: "I'm having trouble reaching the server right now. Please try again in a moment — your question hasn't been lost." };
  });