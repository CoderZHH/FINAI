"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import CoinBadge from "./CoinBadge";

const fetcher = (url) => fetch(url).then((response) => response.json());
const DEFAULT_SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "DOGEUSDT", "XRPUSDT"];

const formatPrice = new Intl.NumberFormat("zh-CN", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function useAnimatedNumber(value, duration = 600) {
  const [displayValue, setDisplayValue] = useState(value);
  const rafRef = useRef();
  const previousRef = useRef(value);

  useEffect(() => {
    const startValue = previousRef.current;
    const delta = value - startValue;
    const startTime = performance.now();

    cancelAnimationFrame(rafRef.current);

    const tick = (now) => {
      const progress = Math.min(1, (now - startTime) / duration);
      setDisplayValue(startValue + delta * progress);
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        previousRef.current = value;
      }
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [value, duration]);

  return displayValue;
}

function usePricePulse(value) {
  const previous = useRef(value);
  const [state, setState] = useState(null);

  useEffect(() => {
    if (previous.current === value) return;
    const direction = value > previous.current ? "up" : "down";
    previous.current = value;
    setState(direction);
    const timer = setTimeout(() => setState(null), 600);
    return () => clearTimeout(timer);
  }, [value]);

  return state;
}

function TickerItem({ symbol, price }) {
  const numericPrice = Number(price) || 0;
  const displaySymbol = String(symbol ?? "").toUpperCase();
  const animatedPrice = useAnimatedNumber(numericPrice);
  const pulse = usePricePulse(numericPrice);
  const priceColor =
    pulse === "up" ? "text-emerald-600" : pulse === "down" ? "text-rose-600" : "text-neutral-600";
  const backgroundColor =
    pulse === "up"
      ? "rgba(16, 185, 129, 0.12)"
      : pulse === "down"
      ? "rgba(248, 113, 113, 0.12)"
      : "rgba(255, 255, 255, 0.75)";
  const borderColor =
    pulse === "up"
      ? "rgba(16, 185, 129, 0.4)"
      : pulse === "down"
      ? "rgba(248, 113, 113, 0.4)"
      : "rgba(226, 232, 240, 0.9)";
  const shadowColor =
    pulse === "up"
      ? "rgba(16, 185, 129, 0.35)"
      : pulse === "down"
      ? "rgba(248, 113, 113, 0.35)"
      : "rgba(15, 23, 42, 0.2)";

  return (
    <div
      className="flex items-center gap-3 rounded-2xl border px-3 py-2.5 text-xs font-semibold shadow-sm transition-all duration-300"
      style={{
        backgroundColor,
        borderColor,
        boxShadow: `0 8px 16px -12px ${shadowColor}`,
      }}
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white shadow-sm">
        <CoinBadge symbol={displaySymbol} size={24} />
      </div>
      <div className="flex flex-col gap-0.5">
        <span className="text-[11px] font-medium text-neutral-500">{displaySymbol}</span>
        <span
          className={`font-mono text-sm font-semibold transition duration-300 ${priceColor}`}
          aria-live="polite"
        >
          US${formatPrice.format(animatedPrice)}
        </span>
      </div>
    </div>
  );
}

export default function TickerBar() {
  const { data } = useSWR("/api/ticker", fetcher, { refreshInterval: 5000 });
  const { data: symbolsData } = useSWR("/api/symbols", fetcher);
  const tickers = data?.tickers ?? [];
  const configuredSymbols = symbolsData?.symbols ?? DEFAULT_SYMBOLS;

  const entries = useMemo(() => {
    if (tickers.length) {
      return tickers.map((item) => ({
        symbol: String(item.symbol ?? "").toUpperCase(),
        price: Number(item.price) || 0,
      }));
    }
    return configuredSymbols.map((symbol) => ({ symbol: String(symbol).toUpperCase(), price: 0 }));
  }, [tickers, configuredSymbols]);

  return (
    <div className="border-b bg-white/80 backdrop-blur">
      <div className="mx-auto max-w-[1920px] px-4">
        <div className="flex gap-2 overflow-x-auto py-2">
          {entries.map((item) => (
            <TickerItem key={item.symbol} symbol={item.symbol} price={item.price} />
          ))}
        </div>
      </div>
    </div>
  );
}
