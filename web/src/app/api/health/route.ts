import { NextResponse } from "next/server";

export async function GET() {
  try {
    const response = await fetch(`${process.env.JWZZ_API_BASE_URL ?? "http://localhost:8080"}/api/health`, {
      cache: "no-store",
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) return NextResponse.json({ status: "unavailable" }, { status: 503 });
    return NextResponse.json(await response.json());
  } catch {
    return NextResponse.json({ status: "unavailable" }, { status: 503 });
  }
}
