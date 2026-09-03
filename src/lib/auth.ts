import { NextResponse } from "next/server";

export function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export function isAuthorized(request: Request): boolean {
  const expected = process.env.INTERNAL_API_KEY;
  if (!expected) return false;
  return request.headers.get("x-internal-api-key") === expected;
}
