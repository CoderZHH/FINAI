"use client";

import useSWR from "swr";

// TODO: 替换为真实行情接口或 WebSocket 推送
const fetcher = (url) => fetch(url).then((r) => r.json());

const COLORS = {
  BTC: "#f7931a",
  ETH: "#627eea",
  SOL: "#9945FF",
  BNB: "#f3ba2f",
  DOGE: "#c2a633",
  XRP: "#23292f",
};

// 目前使用首字母圆形标签，后续可替换为真实币种 SVG 图标
function CoinIcon({ symbol }) {
  const color = COLORS[symbol] || "#999";
  return (
    <span
      aria-hidden
      className="inline-flex items-center justify-center rounded-full text-[10px] font-bold"
      style={{ width: 16, height: 16, background: color, color: "white" }}
    >
      {symbol[0]}
    </span>
  );
}

function TickerItem({ symbol, price }) {
  return (
    <div className="flex items-center gap-2 whitespace-nowrap">
      <CoinIcon symbol={symbol} />
      <span className="font-semibold text-xs">{symbol}</span>
      <span className="text-xs text-neutral-600">${price.toLocaleString()}</span>
    </div>
  );
}

export default function TickerBar() {
  const { data } = useSWR("/api/ticker", fetcher, { suspense: false, refreshInterval: 5000 });
  const tickers = data?.tickers ?? [];
  const fallback = ["BTC", "ETH", "SOL", "BNB", "DOGE", "XRP"];

  const entries =
    tickers.length > 0
      ? tickers.map((item) => ({ symbol: item.symbol, price: item.price }))
      : fallback.map((symbol) => ({ symbol, price: 0 }));

  return (
    <div className="border-b bg-white">
      <div className="mx-auto max-w-[1920px] px-4">
        <div className="flex gap-6 overflow-x-auto py-2">
          {entries.map((item) => (
            <TickerItem key={item.symbol} symbol={item.symbol} price={item.price ?? 0} />
          ))}
        </div>
      </div>
    </div>
  );
}

