import { createSession, verifyUserCredentials } from "../../../../lib/auth/authService.js";
import { NextResponse } from "next/server";

export async function POST(request) {
  try {
    const payload = await request.json();
    const user = await verifyUserCredentials(payload?.username, payload?.password);
    if (!user) {
      return Response.json({ error: "Invalid username or password" }, { status: 401 });
    }
    const session = await createSession(user.id);
    const response = NextResponse.json({
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
      },
    });
    response.cookies.set("finai_session", session.token, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      expires: session.expiresAt,
    });
    response.cookies.set("finai_guest", "", {
      path: "/",
      maxAge: 0,
    });
    return response;
  } catch (error) {
    return Response.json(
      { error: error?.message ?? "login failed" },
      { status: 400 }
    );
  }
}
