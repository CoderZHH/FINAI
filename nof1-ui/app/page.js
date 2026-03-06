import Link from "next/link";

export default function HomePage() {
  return (
    <main className="min-h-screen bg-gradient-to-b from-neutral-50 via-white to-neutral-100 text-neutral-900">
      <section className="mx-auto flex min-h-screen max-w-6xl flex-col items-center justify-center px-6 py-20 text-center">
        <p className="mb-4 rounded-full border border-neutral-200 bg-white px-4 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-neutral-500">
          FINAI Trading Arena
        </p>
        <h1 className="text-4xl font-black leading-tight sm:text-6xl">
          AI 交易策略
          <br />
          实时对抗与复盘平台
        </h1>
        <p className="mt-6 max-w-2xl text-base text-neutral-600 sm:text-lg">
          连接市场、驱动模型、对比绩效。注册后创建你的策略账户，查看实时曲线、持仓和日志。
        </p>

        <div className="mt-12 flex flex-col items-center gap-3">
          <Link
            href="/auth/login"
            className="rounded-xl bg-neutral-900 px-8 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-neutral-800"
          >
            开始我的投资之旅
          </Link>
          <Link href="/auth/guest" className="text-xs text-neutral-500 underline underline-offset-4">
            以游客身份观看比赛
          </Link>
        </div>
      </section>
    </main>
  );
}
