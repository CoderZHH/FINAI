import { ensureRootUser, getSessionByToken, getUserByUsername } from "./authService.js";

// Next.js 的 Route Handler 拿到的是原始 Request，这里先把 Cookie
// 头解析成普通对象，后面按 cookie 名读取登录态或游客态。
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

  // 游客模式不会真的创建一个 guest 用户，而是复用 root 的数据视图，
  // 同时强制只读，这样游客能看盘但不能改数据。
  if (allowGuest && cookies.finai_guest === "1") {
    await ensureRootUser();
    const root = await getUserByUsername("root");
    if (!root) return null;
    try {
      // 确保 root 的基准线存在，这样游客进来时首页一定有可展示的数据。
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

  // 已登录浏览器里只保存 session token，本身不携带完整用户信息。
  // 真正的用户身份需要服务端再去 user_sessions 表里解析。
  const session = await getSessionByToken(token);
  if (!session) return null;
  try {
    // 顺手自愈用户 baseline，保证新用户第一次进入 dashboard 时不用手动初始化。
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
  // 这是 API 路由统一使用的鉴权入口，匿名、游客、登录用户都走同一套规则。
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
  // 浏览器里只存 session token；这里把过期时间同步进 cookie，
  // 让 cookie 生命周期和服务端 session 记录保持一致。
  const maxAge = Math.max(1, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000));
  return `finai_session=${encodeURIComponent(
    token
  )}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;
}

export function clearAuthCookie() {
  return "finai_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0";
}

export function guestCookie() {
  // 游客模式只需要一个轻量标记 cookie，不需要真的写一条 session 记录，
  // 因为它永远映射到 root 的只读身份。
  return "finai_guest=1; Path=/; SameSite=Lax; Max-Age=31536000";
}

export function clearGuestCookie() {
  return "finai_guest=; Path=/; SameSite=Lax; Max-Age=0";
}
