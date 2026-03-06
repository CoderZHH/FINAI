import { getRequestPrincipal } from "../../../../lib/auth/requestAuth.js";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const principal = await getRequestPrincipal(request, { allowGuest: true });
  if (!principal) {
    return Response.json(
      { user: null },
      {
        status: 200,
        headers: { "Cache-Control": "private, no-store, max-age=0" },
      }
    );
  }
  return Response.json(
    {
      user: {
        id: principal.userId,
        username: principal.username,
        role: principal.role,
        guest: principal.kind === "guest",
        readOnly: principal.readOnly,
      },
    },
    { headers: { "Cache-Control": "private, no-store, max-age=0" } }
  );
}
