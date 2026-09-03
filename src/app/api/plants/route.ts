import { NextResponse } from "next/server";
import { isAuthorized, unauthorized } from "@/lib/auth";
import { listPlants } from "@/lib/plants";

export async function GET(request: Request) {
  if (!isAuthorized(request)) return unauthorized();

  const plants = await listPlants();
  return NextResponse.json({ plants });
}
