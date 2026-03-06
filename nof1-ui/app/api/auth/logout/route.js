import { deleteSession } from "../../../../lib/auth/authService.js";
import { getRequestPrincipal } from "../../../../lib/auth/requestAuth.js";
import { NextResponse } from "next/server";

export async function POST(request) {
  const principal = await getRequestPrincipal(request, { allowGuest: true });
  if (principal?.sessionToken) {
    await deleteSession(principal.sessionToken);
  }
  const response = NextResponse.json({ ok: true });
  response.cookies.set("finai_session", "", {
    path: "/",
    maxAge: 0,
  });
  response.cookies.set("finai_guest", "", {
    path: "/",
    maxAge: 0,
  });
  return response;
}
