import { NextResponse } from "next/server";
import { SESSION_COOKIE, UPSTOX_COOKIE } from "@/app/lib/auth";

// Clear both cookies and bounce to the login screen.
function clearAndRedirect(request) {
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  const res = NextResponse.redirect(url);
  res.cookies.delete(SESSION_COOKIE);
  res.cookies.delete(UPSTOX_COOKIE);
  return res;
}

export async function GET(request) {
  return clearAndRedirect(request);
}
export async function POST(request) {
  return clearAndRedirect(request);
}
