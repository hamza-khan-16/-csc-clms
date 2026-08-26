/**
 * moderation.functions.ts
 *
 * Server-side Groq calls via createServerFn.
 * Running on the server solves two problems:
 *   1. CORS — Groq blocks direct browser → api.groq.com requests
 *   2. Key safety — GEMINI_API_KEY stays in the server env, never in the bundle
 */

import { createServerFn } from "@tanstack/react-start";

const GEMINI_API = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";

const GEMINI_MODELS = [
  "gemini-3.5-flash",       // 1M TPM free tier — primary
  "gemini-2.5-flash-lite",  // lighter fallback
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
        if (res.status === 404) continue;
        if (!res.ok) return { verdict: "CLEAN" };
        const json = await res.json() as { choices?: { message?: { content?: string } }[] };
        const raw = (json?.choices?.[0]?.message?.content ?? "").trim().toUpperCase();
        if (raw.startsWith("ABUSIVE")) return { verdict: "ABUSIVE" };
        if (raw.startsWith("UNCLEAR")) return { verdict: "UNCLEAR" };
        return { verdict: "CLEAN" };
      } catch { continue; }
    }
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

    // Use the more capable model for chat (falls back to lighter ones)
    const CHAT_MODELS = [
      "gemini-3.5-flash",       // 1M TPM free tier — primary
      "gemini-2.5-flash-lite",  // lighter fallback
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
        if (res.status === 404) continue;
        if (!res.ok) {
          console.error("LeaveBot Groq error:", await res.text());
          return { reply: "Sorry, I couldn't reach the server right now. Please try again in a moment." };
        }
        const json = await res.json() as { choices?: { message?: { content?: string } }[] };
        return { reply: json?.choices?.[0]?.message?.content?.trim() ?? "I didn't get a response. Please try again." };
      } catch { continue; }
    }
    return { reply: "Sorry, I couldn't reach the server right now. Please try again in a moment." };
  });