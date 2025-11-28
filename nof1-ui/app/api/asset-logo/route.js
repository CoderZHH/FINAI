"use server";

import { NextResponse } from "next/server";

const LOGO_BASES = [
  "https://bin.bnbstatic.com/static/assets/logos/{symbol}.png",
  "https://bin.bnbstatic.com/static/assets/logos/{symbolLower}.png",
  "https://www.binance.com/resources/img/logo/{symbol}.png",
];

async function fetchLogo(symbol) {
  for (const template of LOGO_BASES) {
    const url = template
      .replace("{symbol}", symbol.toUpperCase())
      .replace("{symbolLower}", symbol.toLowerCase());
    const res = await fetch(url, {
      headers: {
        // Avoid strict referer policies that can trigger 403
        Referer: "https://www.binance.com/",
      },
    });
    if (res.ok) {
      const buffer = Buffer.from(await res.arrayBuffer());
      const contentType = res.headers.get("content-type") || "image/png";
      const resp = new NextResponse(buffer, { status: 200 });
      resp.headers.set("Content-Type", contentType);
      resp.headers.set("Cache-Control", "public, max-age=3600");
      return resp;
    }
  }
  return null;
}

export async function GET(request) {
  const url = new URL(request.url);
  const raw = url.searchParams.get("symbol") || "";
  const symbol = raw.trim();
  if (!symbol) {
    return NextResponse.json({ error: "symbol is required" }, { status: 400 });
  }
  const resp = await fetchLogo(symbol);
  if (resp) return resp;
  return NextResponse.json({ error: "logo not found" }, { status: 404 });
}
