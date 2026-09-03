import { NextResponse } from "next/server";
import { isAuthorized, unauthorized } from "@/lib/auth";
import { importDailyOutput } from "@/lib/import";

export async function POST(request: Request) {
  if (!isAuthorized(request)) return unauthorized();

  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ success: false, message: "No file selected." }, { status: 400 });
  }

  const result = await importDailyOutput(file);
  return NextResponse.json(result, { status: result.success ? 200 : 422 });
}
