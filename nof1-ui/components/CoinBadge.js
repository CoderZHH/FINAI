"use client";

import { logger } from "@/lib/logManager";

const ICON_MAP = {
  BTC: "/icons/coin/btc.svg",
  ETH: "/icons/coin/eth.svg",
  SOL: "/icons/coin/sol.svg",
  BNB: "/icons/coin/bnb.svg",
  DOGE: "/icons/coin/doge.svg",
  XRP: "/icons/coin/xrp.svg",
};

function normalizeSymbol(symbol = "") {
  // 移除 USDT 后缀并转换为大写
  return String(symbol).replace(/USDT$/i, "").toUpperCase();
}

export default function CoinBadge({ symbol, size = 20, className = "" }) {
  const normalized = normalizeSymbol(symbol);
  const src = ICON_MAP[normalized];
  
  if (src) {
    return (
      <img
        src={src}
        alt={`${normalized} icon`}
        width={size}
        height={size}
        className={`rounded-full object-contain ${className}`}
      />
    );
  }

  return (
    <span
      className={`inline-flex items-center justify-center rounded-full bg-neutral-800 text-[10px] font-semibold text-white ${className}`}
      style={{ width: size, height: size }}
    >
      {normalized.slice(0, 2) || "?"}
    </span>
  );
}
