import { getRequestPrincipal } from "../../../../lib/auth/requestAuth.js";

export async function GET(request) {
  const principal = await getRequestPrincipal(request, { allowGuest: true });
  if (!principal) {
    return Response.json({ user: null }, { status: 200 });
  }
  return Response.json({
    user: {
      id: principal.userId,
      username: principal.username,
      role: principal.role,
      guest: principal.kind === "guest",
      readOnly: principal.readOnly,
    },
  });
}
