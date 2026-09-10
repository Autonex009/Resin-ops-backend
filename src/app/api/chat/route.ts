import { NextResponse } from "next/server";
import { getDb } from "@/db";
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
import { getCapacityByStream as getCapacityByPlantStream } from "@/lib/capacity";
import { listPlants } from "@/lib/plants";

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
    "- All output, plan, and capacity quantities are in cubic metres (m³). Always",
    "  use the m³ unit; never report MT, tonnes, or any other unit.",
    "- The DATA includes every batch and every sales commitment individually, plus",
    "  per-plant and per-stream capacity and output. Break figures down by plant,",
    "  stream, product, status or schedule whenever asked — the detail is there.",
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

// Full dataset behind every dashboard tab: the KPI aggregates plus every
// individual batch and sales commitment and the per-plant/stream capacity, so
// the assistant can break figures down by plant, stream, product, status, etc.
async function buildContext() {
  const db = getDb();
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
    .toISOString()
    .slice(0, 10);
  const today = now.toISOString().slice(0, 10);

  const [
    output,
    capacity,
    batchesBehind,
    commitmentsShort,
    capacityByStream,
    outputByPlant,
    batchesSchedule,
    commitmentsAging,
    plantList,
    capacityByPlantStream,
    batchRows,
    commitmentRows,
  ] = await Promise.all([
    getMonthlyOutputSummary(),
    getCapacityUtilization(),
    getBatchesBehindCount(),
    getCommitmentsShortCount(),
    getCapacityByStream(),
    getOutputByPlant(),
    getBatchesScheduleSummary(),
    getCommitmentsAging(),
    listPlants(),
    getCapacityByPlantStream(monthStart),
    db.query.batches.findMany({ with: { plant: true } }),
    db.query.salesCommitments.findMany({ with: { plant: true } }),
  ]);

  const isBehind = (b: (typeof batchRows)[number]) =>
    b.actualCompletion ? b.actualCompletion > b.plannedCompletion : b.plannedCompletion < today;

  const batches = batchRows.map((b) => ({
    batch: b.batchNumber,
    plant: b.plant?.code ?? null,
    stream: b.stream,
    plannedQty: Number(b.plannedQty),
    actualQty: b.actualQty === null ? null : Number(b.actualQty),
    plannedCompletion: b.plannedCompletion,
    actualCompletion: b.actualCompletion,
    status: b.status,
    schedule: isBehind(b) ? "behind" : "on_track",
  }));

  const isShort = (c: (typeof commitmentRows)[number]) =>
    c.requiredDate !== null && c.requiredDate < today && Number(c.balanceQty) > 0;

  // Row-level commitments, but WITHOUT customer names or balance ₹value — those
  // are PII / commercial data and this context is sent to an external API
  // (DeepSeek). Operational fields only, which still answer plant/stream/
  // product/status breakdowns.
  const commitments = commitmentRows.map((c) => ({
    order: c.salesOrderNumber,
    orderDate: c.salesOrderDate,
    requiredDate: c.requiredDate,
    itemCode: c.itemCode,
    item: c.itemDescription,
    balanceQty: Number(c.balanceQty),
    businessGroup: c.businessGroup,
    plant: c.plant?.code ?? null,
    status: isShort(c) ? "short" : "on_track",
  }));

  return {
    month: monthStart.slice(0, 7),
    today,
    output,
    capacity,
    batchesBehind,
    commitmentsShort,
    batchesSchedule,
    capacityByStream,
    capacityByPlantStream,
    outputByPlant,
    commitmentsAging,
    plants: plantList.map((p) => ({ code: p.code, name: p.name })),
    batches,
    commitments,
  };
}
