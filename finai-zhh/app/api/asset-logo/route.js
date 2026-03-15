"use server";

import fs from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

const LOGO_BASES = [
  "https://bin.bnbstatic.com/static/assets/logos/{symbol}.png",
  "https://bin.bnbstatic.com/static/assets/logos/{symbolLower}.png",
  "https://www.binance.com/resources/img/logo/{symbol}.png",
];
const LOCAL_LOGO_DIR = path.join(process.cwd(), "public", "icons", "symbol");

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function buildFallbackSvg(symbol) {
  const text = escapeXml(symbol.toUpperCase().slice(0, 2) || "?");
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64" role="img" aria-label="${text}">
  <circle cx="32" cy="32" r="32" fill="#171717" />
  <text x="50%" y="50%" dominant-baseline="central" text-anchor="middle" fill="#ffffff" font-family="Arial, sans-serif" font-size="22" font-weight="700">${text}</text>
</svg>`;
}

async function fetchLogo(symbol) {
  for (const template of LOGO_BASES) {
    const url = template
      .replace("{symbol}", symbol.toUpperCase())
      .replace("{symbolLower}", symbol.toLowerCase());
    try {
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
    } catch {
      // 上游图标源超时或不可达时，继续尝试下一个源
    }
  }
  return null;
}

async function readLocalLogo(symbol) {
  const candidates = [
    `${symbol.toUpperCase()}.png`,
    `${symbol.toLowerCase()}.png`,
    `${symbol.toUpperCase()}.svg`,
    `${symbol.toLowerCase()}.svg`,
  ];

  for (const fileName of candidates) {
    const filePath = path.join(LOCAL_LOGO_DIR, fileName);
    try {
      const buffer = await fs.readFile(filePath);
      const contentType = fileName.endsWith(".svg")
        ? "image/svg+xml"
        : "image/png";
      const resp = new NextResponse(buffer, { status: 200 });
      resp.headers.set("Content-Type", contentType);
      resp.headers.set("Cache-Control", "public, max-age=3600");
      return resp;
    } catch {
      // 本地图标不存在时继续尝试下一个候选文件
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
  const localResp = await readLocalLogo(symbol);
  if (localResp) return localResp;
  return new NextResponse(buildFallbackSvg(symbol), {
    status: 200,
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
