import { NextResponse } from "next/server";
import { ensureRootUser } from "../../../../lib/auth/authService.js";

export async function POST() {
  await ensureRootUser();
  const response = NextResponse.json({ ok: true });
  response.cookies.set("finai_guest", "1", {
    sameSite: "lax",
    path: "/",
    maxAge: 31536000,
  });
  response.cookies.set("finai_session", "", {
    path: "/",
    maxAge: 0,
  });
  return response;
}
