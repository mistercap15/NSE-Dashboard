import { NextResponse } from "next/server"
import { hasValidToken } from "@/app/lib/upstox"

export async function GET() {
  return NextResponse.json({ connected: hasValidToken() })
}
