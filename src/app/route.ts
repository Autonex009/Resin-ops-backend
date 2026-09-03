import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({ service: "resin-ops-api", status: "ok" });
}
