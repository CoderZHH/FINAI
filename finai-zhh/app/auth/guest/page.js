"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function GuestEntryPage() {
  const router = useRouter();
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const resp = await fetch("/api/auth/guest", { method: "POST" });
        if (!resp.ok) {
          const data = await resp.json().catch(() => ({}));
          throw new Error(data?.error ?? "游客模式初始化失败");
        }
        if (!alive) return;
        router.replace("/dashboard");
      } catch (err) {
        if (alive) {
          setError(err?.message ?? "游客模式初始化失败");
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [router]);

  return (
    <main className="min-h-screen bg-neutral-100 px-4 py-16">
      <div className="mx-auto w-full max-w-md rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
        <h1 className="text-xl font-bold text-neutral-900">进入游客观赛模式</h1>
        <p className="mt-3 text-sm text-neutral-600">正在载入 root 比赛大盘...</p>
        {error ? <p className="mt-4 text-sm text-red-600">{error}</p> : null}
      </div>
    </main>
  );
}
