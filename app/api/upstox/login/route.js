import { getLoginUrl } from "@/app/lib/upstox"
import { safeNext } from "@/app/lib/auth"
import { redirect } from "next/navigation"

export async function GET(request) {
  const next = safeNext(request.nextUrl.searchParams.get("next"))
  // Carry the post-login destination through Upstox as `state`.
  redirect(getLoginUrl(next))
}
