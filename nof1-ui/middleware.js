import { NextResponse } from "next/server";

const PUBLIC_PATHS = ["/", "/auth"];
const PUBLIC_API_PREFIX = "/api/auth";
const DASHBOARD_PREFIXES = ["/dashboard", "/models", "/settings"];

function isPublicPath(pathname) {
  return PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

function hasAuthCookie(request) {
  const session = request.cookies.get("finai_session")?.value;
  const guest = request.cookies.get("finai_guest")?.value;
  return Boolean(session || guest === "1");
}

function isGuest(request) {
  return request.cookies.get("finai_guest")?.value === "1";
}

function isApiRequest(pathname) {
  return pathname.startsWith("/api/");
}

function isProtectedDashboard(pathname) {
  return DASHBOARD_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}

export function middleware(request) {
  const { pathname } = request.nextUrl;

  if (
    pathname.startsWith("/_next/") ||
    pathname === "/favicon.ico" ||
    pathname.match(/\.(?:png|jpg|jpeg|gif|svg|webp|css|js|map|txt)$/)
  ) {
    return NextResponse.next();
  }

  if (isApiRequest(pathname) && pathname.startsWith(PUBLIC_API_PREFIX)) {
    return NextResponse.next();
  }

  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  if (!hasAuthCookie(request)) {
    if (isApiRequest(pathname)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/auth/login";
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  const guest = isGuest(request);
  const method = request.method.toUpperCase();

  if (guest && isApiRequest(pathname) && !["GET", "HEAD", "OPTIONS"].includes(method)) {
    return NextResponse.json({ error: "Guest mode is read-only" }, { status: 403 });
  }

  if (guest && pathname === "/api/logs/stream") {
    return NextResponse.json({ error: "Guest cannot access live logs" }, { status: 403 });
  }

  if (isProtectedDashboard(pathname)) {
    return NextResponse.next();
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/:path*"],
};
