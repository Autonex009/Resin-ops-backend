import { NextResponse } from "next/server";
import { isAuthorized, unauthorized } from "@/lib/auth";
import {
  getMonthlyOutputSummary,
  getCapacityUtilization,
  getBatchesBehindCount,
  getCommitmentsShortCount,
  getCapacityByStream,
  getOutputByPlant,
  getBatchesScheduleSummary,
  getCommitmentsAging,
} from "@/lib/kpis";

// The chat endpoint gathers live dashboard data and asks DeepSeek to answer
// over it. The DeepSeek key never leaves the backend — the frontend proxies
// here with the internal API key, and the browser never sees either secret.
export const dynamic = "force-dynamic";

type ChatMessage = { role: "user" | "assistant"; content: string };

const DEEPSEEK_BASE_URL = (process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com").replace(/\/$/, "");
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL ?? "deepseek-chat";
const MAX_MESSAGES = 20;
const MAX_CONTENT_CHARS = 4000;

export async function POST(request: Request) {
  if (!isAuthorized(request)) return unauthorized();

  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Chat is not configured. Set DEEPSEEK_API_KEY on the backend." },
      { status: 503 },
    );
  }

  let payload: { messages?: unknown };
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const messages: ChatMessage[] = Array.isArray(payload.messages)
    ? (payload.messages as ChatMessage[])
        .filter(
          (m) =>
            m &&
            (m.role === "user" || m.role === "assistant") &&
            typeof m.content === "string" &&
            m.content.trim() !== "",
        )
        .slice(-MAX_MESSAGES)
        .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_CONTENT_CHARS) }))
    : [];

  if (messages.length === 0) {
    return NextResponse.json({ error: "No messages provided." }, { status: 400 });
  }

  let context: unknown;
  try {
    context = await buildContext();
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load dashboard data." },
      { status: 500 },
    );
  }

  const systemPrompt = [
    "You are the built-in assistant for Resin Ops, Thermax's ion-exchange resin",
    "production planning dashboard. Answer questions about the current month's plan",
    "attainment, capacity utilization, manufacturing streams (Cation, Anion, Mixed",
    "Bed), batches, and sales commitments.",
    "",
    "Rules:",
    "- Always reply in English, regardless of the language the question is asked in.",
    "- Use ONLY the DATA below. Do not invent or estimate numbers.",
    "- If the data does not contain the answer, say so plainly and suggest which",
    "  import or page might have it.",
    "- Be concise and quote the exact figures from the data.",
    "- Percentages and quantities are for the current month unless stated otherwise.",
    "",
    `DATA (JSON):\n${JSON.stringify(context)}`,
  ].join("\n");

  try {
    const res = await fetch(`${DEEPSEEK_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: DEEPSEEK_MODEL,
        messages: [{ role: "system", content: systemPrompt }, ...messages],
        temperature: 0.2,
        stream: false,
      }),
      cache: "no-store",
    });

    if (!res.ok) {
      const raw = await res.text().catch(() => "");
      let message = `DeepSeek request failed (${res.status}).`;
      try {
        const parsed = JSON.parse(raw);
        if (parsed?.error?.message) message = `DeepSeek: ${parsed.error.message}`;
      } catch {
        // non-JSON error body — keep the generic message
      }
      if (res.status === 402) {
        message += " Add credit to the DeepSeek account to enable the assistant.";
      }
      return NextResponse.json({ error: message, detail: raw.slice(0, 500) }, { status: 502 });
    }

    const data = await res.json();
    const reply: string = data?.choices?.[0]?.message?.content ?? "";
    if (!reply) {
      return NextResponse.json({ error: "DeepSeek returned an empty response." }, { status: 502 });
    }
    return NextResponse.json({ reply });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Chat request failed." },
      { status: 502 },
    );
  }
}

// Compact snapshot of the same KPI aggregates the Overview uses, so the model
// answers from the same numbers the user sees on screen.
async function buildContext() {
  const [
    output,
    capacity,
    batchesBehind,
    commitmentsShort,
    capacityByStream,
    outputByPlant,
    batchesSchedule,
    commitmentsAging,
  ] = await Promise.all([
    getMonthlyOutputSummary(),
    getCapacityUtilization(),
    getBatchesBehindCount(),
    getCommitmentsShortCount(),
    getCapacityByStream(),
    getOutputByPlant(),
    getBatchesScheduleSummary(),
    getCommitmentsAging(),
  ]);

  return {
    month: new Date().toISOString().slice(0, 7),
    output,
    capacity,
    batchesBehind,
    commitmentsShort,
    capacityByStream,
    outputByPlant,
    batchesSchedule,
    commitmentsAging,
  };
}
