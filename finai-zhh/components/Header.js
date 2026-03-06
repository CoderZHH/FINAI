"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import useSWR from "swr";

const fetcher = async (url) => {
  const response = await fetch(url);
  if (!response.ok) return { user: null };
  return response.json();
};

export default function Header() {
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);
  const { data, mutate } = useSWR("/api/auth/me", fetcher, {
    revalidateOnFocus: false,
  });

  const user = data?.user ?? null;
  const isGuest = Boolean(user?.guest);

  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      await mutate({ user: null }, false);
      router.replace("/auth/login");
      router.refresh();
    } finally {
      setLoggingOut(false);
    }
  };

  return (
    <header className="sticky top-0 z-40 border-b bg-white/90 backdrop-blur supports-[backdrop-filter]:bg-white/60">
      <div className="mx-auto max-w-[1920px] px-4">
        <div className="flex h-14 items-center justify-between gap-6">
          <div className="flex items-center gap-6">
            <Link href="/dashboard" className="text-xl font-black tracking-tight">
              ZHH赚钱助手
            </Link>
            <nav className="hidden items-center gap-6 text-sm md:flex">
              <Link className="hover:underline" href="/dashboard">
                实盘
              </Link>
              <Link className="hover:underline" href="/models">
                模型库
              </Link>
              <Link className="hover:underline" href="/settings">
                设置
              </Link>
            </nav>
          </div>
          <div className="flex items-center gap-3 text-xs">
            {user ? (
              <span
                className={`inline-flex items-center rounded-full px-2.5 py-1 font-semibold ${
                  isGuest
                    ? "bg-amber-100 text-amber-700"
                    : "bg-emerald-100 text-emerald-700"
                }`}
              >
                {isGuest ? "游客只读" : `用户：${user.username}`}
              </span>
            ) : null}
            {user ? (
              <button
                type="button"
                onClick={handleLogout}
                disabled={loggingOut}
                className="rounded-full border border-neutral-300 px-3 py-1 font-semibold text-neutral-700 transition hover:bg-neutral-50 disabled:opacity-60"
              >
                {loggingOut ? "退出中..." : "退出登录"}
              </button>
            ) : (
              <Link
                href="/auth/login"
                className="rounded-full border border-neutral-300 px-3 py-1 font-semibold text-neutral-700 transition hover:bg-neutral-50"
              >
                登录
              </Link>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
