"use client";

import { useState } from "react";
import { logger } from "@/lib/logManager";

function normalizeSymbol(symbol = "") {
  // 移除 USDT 后缀并转换为大写
  return String(symbol).replace(/USDT$/i, "").toUpperCase();
}

export default function CoinBadge({ symbol, size = 20, className = "" }) {
  const normalized = normalizeSymbol(symbol);
  const proxySrc = `/api/asset-logo?symbol=${encodeURIComponent(normalized)}`;
  const [mode, setMode] = useState("remote");

  const renderFallback = () => (
    <span
      className={`inline-flex items-center justify-center rounded-full bg-neutral-800 text-[10px] font-semibold text-white ${className}`}
      style={{ width: size, height: size }}
    >
      {normalized.slice(0, 2) || "?"}
    </span>
  );

  if (mode === "remote") {
    return (
      <img
        src={proxySrc}
        alt={`${normalized} icon`}
        width={size}
        height={size}
        className={`rounded-full object-contain ${className}`}
        onError={() => {
          logger.debug("CoinBadge", "proxy icon failed, fallback", { symbol: normalized });
          setMode("fallback");
        }}
      />
    );
  }

  return renderFallback();
}
