// No remote requests, local Python invocation or paper-account mutations.
import { NextResponse } from "next/server";

function retired() {
  return NextResponse.json({ error: "Feature retired", code: "FEATURE_RETIRED" }, { status: 410 });
}

export { retired as GET, retired as POST, retired as PUT, retired as PATCH, retired as DELETE };
