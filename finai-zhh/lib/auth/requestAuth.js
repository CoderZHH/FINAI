import { ensureRootUser, getSessionByToken, getUserByUsername } from "./authService.js";

function parseCookies(request) {
  const header = request.headers.get("cookie") ?? "";
  return header.split(";").reduce((acc, part) => {
    const [rawKey, ...rest] = part.trim().split("=");
    if (!rawKey) return acc;
    acc[rawKey] = decodeURIComponent(rest.join("=") ?? "");
    return acc;
  }, {});
}

function jsonError(status, error) {
  return Response.json({ error }, { status });
}

export async function getRequestPrincipal(request, { allowGuest = true } = {}) {
  const cookies = parseCookies(request);
  if (allowGuest && cookies.finai_guest === "1") {
    await ensureRootUser();
    const root = await getUserByUsername("root");
    if (!root) return null;
    try {
      const { ensureUserBaseline } = await import("../data/dataRepository.js");
      await ensureUserBaseline(root.id);
    } catch (error) {
      console.warn("[auth] ensure guest baseline failed:", error?.message);
    }
    return {
      kind: "guest",
      userId: root.id,
      username: root.username,
      role: "GUEST",
      readOnly: true,
    };
  }

  const token = cookies.finai_session;
  if (!token) return null;
  const session = await getSessionByToken(token);
  if (!session) return null;
  try {
    const { ensureUserBaseline } = await import("../data/dataRepository.js");
    await ensureUserBaseline(session.user.id);
  } catch (error) {
    console.warn("[auth] ensure user baseline failed:", error?.message);
  }
  return {
    kind: "user",
    userId: session.user.id,
    username: session.user.username,
    role: session.user.role,
    readOnly: false,
    sessionToken: token,
  };
}

export async function requirePrincipal(
  request,
  { allowGuest = true, requireWrite = false } = {}
) {
  const principal = await getRequestPrincipal(request, { allowGuest });
  if (!principal) {
    return {
      ok: false,
      response: jsonError(401, "Unauthorized"),
    };
  }
  if (requireWrite && principal.kind === "guest") {
    return {
      ok: false,
      response: jsonError(403, "Guest mode is read-only"),
    };
  }
  return { ok: true, principal };
}

export function authCookie(token, expiresAt) {
  const maxAge = Math.max(1, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000));
  return `finai_session=${encodeURIComponent(
    token
  )}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;
}

export function clearAuthCookie() {
  return "finai_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0";
}

export function guestCookie() {
  return "finai_guest=1; Path=/; SameSite=Lax; Max-Age=31536000";
}

export function clearGuestCookie() {
  return "finai_guest=; Path=/; SameSite=Lax; Max-Age=0";
}
