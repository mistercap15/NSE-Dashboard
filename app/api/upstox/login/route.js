import { getLoginUrl } from "@/app/lib/upstox"
import { redirect } from "next/navigation"

export async function GET() {
  const loginUrl = getLoginUrl()
  return redirect(loginUrl)
}
