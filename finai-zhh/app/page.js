"use client";

import Link from "next/link";
import { useEffect } from "react";

const metrics = [
  { label: "运行闭环", value: "市场 → 决策 → 执行 → 曲线" },
  { label: "系统栈", value: "Next.js + Worker + PostgreSQL" },
  { label: "输出形态", value: "Structured JSON" },
];

const sections = [
  {
    eyebrow: "Signal Engine",
    title: "像交易系统，不像聊天窗口",
    body: "模型输出被约束成结构化决策，再进入模拟执行、保证金核算、账户快照和收益曲线更新，整个链路可追踪、可复盘、可比较。",
  },
  {
    eyebrow: "Runtime Layer",
    title: "后台常驻，不靠手动刷新",
    body: "市场同步、模型调度、基准线重估值和账户时序写入都由独立 worker 持续完成，前端只负责读取和展示。",
  },
  {
    eyebrow: "Operator View",
    title: "看得见推理，也看得见结果",
    body: "你可以同时看到模型配置、提示词模板、实时权益曲线、最近交易、日志流和待审核决策，而不是只有一个结果页面。",
  },
];

const flow = [
  "市场数据持续同步",
  "指标序列进入提示词",
  "LLM 输出结构化决策",
  "模拟执行并更新账户",
  "图表与日志实时反映",
];

export default function HomePage() {
  useEffect(() => {
    const nodes = document.querySelectorAll("[data-reveal]");
    if (!nodes.length || typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
          }
        });
      },
      {
        threshold: 0.18,
        rootMargin: "0px 0px -10% 0px",
      }
    );

    nodes.forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, []);

  return (
    <main className="apple-home text-neutral-950">
      <section className="apple-hero-shell">
        <div className="apple-orb apple-orb-left" />
        <div className="apple-orb apple-orb-right" />
        <div className="apple-orb apple-orb-center" />
        <div className="apple-grid" />

        <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-6 pb-16 pt-10 sm:px-10">
          <div className="apple-fade-up flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.34em] text-neutral-500">
            <span>FinAI</span>
            <span className="hidden sm:inline">Multi-Model Trading Runtime</span>
          </div>

          <div className="grid flex-1 items-center gap-14 py-14 lg:grid-cols-[1.08fr_0.92fr] lg:py-20">
            <div className="max-w-4xl">
              <div className="apple-fade-up-delay inline-flex rounded-full border border-white/70 bg-white/75 px-4 py-2 text-xs font-medium tracking-[0.16em] text-neutral-600 shadow-[0_10px_40px_rgba(15,23,42,0.06)] backdrop-blur-xl">
                AI 模型交易实验场
              </div>

              <h1 className="apple-hero-title apple-fade-up mt-8 text-[4.2rem] font-semibold leading-[0.9] tracking-[-0.08em] text-neutral-950 sm:text-[5.4rem] lg:text-[7.3rem]">
                交易，<br />开始自运转
              </h1>

              <p className="apple-fade-up-delay mt-8 max-w-2xl text-lg leading-8 text-neutral-600 sm:text-xl">
                FinAI 不是只会生成观点的页面，而是一套从盯盘、决策、执行到账户核算和收益可视化的 AI 模拟交易系统。
              </p>

              <div className="apple-fade-up-delay mt-10 flex flex-col gap-4 sm:flex-row">
                <Link
                  href="/auth/login"
                  className="apple-primary-btn inline-flex items-center justify-center rounded-full px-7 py-3.5 text-sm font-semibold text-white"
                >
                  进入系统
                </Link>
                <Link
                  href="/auth/guest"
                  className="inline-flex items-center justify-center rounded-full border border-neutral-300/80 bg-white/80 px-7 py-3.5 text-sm font-semibold text-neutral-800 shadow-[0_10px_30px_rgba(15,23,42,0.05)] backdrop-blur-xl transition hover:border-neutral-400 hover:bg-white"
                >
                  游客只读预览
                </Link>
              </div>

              <div className="apple-fade-up-delay mt-10 grid gap-4 sm:grid-cols-3">
                {metrics.map((item) => (
                  <div
                    key={item.label}
                    className="rounded-[28px] border border-white/70 bg-white/68 px-5 py-5 shadow-[0_20px_50px_rgba(15,23,42,0.06)] backdrop-blur-2xl"
                  >
                    <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-neutral-400">
                      {item.label}
                    </div>
                    <div className="mt-3 text-sm font-medium leading-6 text-neutral-700">
                      {item.value}
                    </div>
                  </div>
                ))}
              </div>

              <div className="apple-scroll-cue apple-fade-up-delay mt-14">
                <div className="apple-scroll-mouse">
                  <span />
                </div>
                <span>向下继续看</span>
              </div>
            </div>

            <div className="apple-fade-up-delay relative mx-auto w-full max-w-[580px]">
              <div className="apple-device-frame">
                <div className="apple-device-header">
                  <span className="apple-dot bg-[#ff5f57]" />
                  <span className="apple-dot bg-[#febc2e]" />
                  <span className="apple-dot bg-[#28c840]" />
                </div>

                <div className="grid gap-4">
                  <div className="rounded-[26px] border border-white/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.95),rgba(244,246,250,0.88))] p-5 shadow-[0_20px_40px_rgba(15,23,42,0.07)]">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-[11px] font-semibold uppercase tracking-[0.26em] text-neutral-400">
                          Account Equity
                        </div>
                        <div className="mt-3 text-3xl font-semibold tracking-[-0.04em]">
                          US$10,551.31
                        </div>
                      </div>
                      <div className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                        +5.51%
                      </div>
                    </div>

                    <div className="mt-6 overflow-hidden rounded-[22px] border border-neutral-200/70 bg-white/70 p-4">
                      <div className="mb-3 flex items-center justify-between text-xs text-neutral-400">
                        <span>BTC Benchmark</span>
                        <span>Live curve</span>
                      </div>
                      <div className="apple-chart-line">
                        <span />
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-[1.15fr_0.85fr]">
                    <div className="rounded-[26px] border border-white/80 bg-white/82 p-5 shadow-[0_20px_40px_rgba(15,23,42,0.06)] backdrop-blur-2xl">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.26em] text-neutral-400">
                        Decision Stream
                      </div>
                      <div className="mt-4 space-y-3">
                        <div className="apple-stream-item apple-stream-item-1 rounded-2xl bg-neutral-950 px-4 py-3 text-sm text-white">
                          DeepSeek Long BTC · leverage 5x
                        </div>
                        <div className="apple-stream-item apple-stream-item-2 rounded-2xl bg-neutral-100 px-4 py-3 text-sm text-neutral-700">
                          Gemini Hold ETH · waiting for structure
                        </div>
                        <div className="apple-stream-item apple-stream-item-3 rounded-2xl bg-neutral-100 px-4 py-3 text-sm text-neutral-700">
                          Claude Close XRP · invalidation hit
                        </div>
                      </div>
                    </div>

                    <div className="rounded-[26px] border border-white/80 bg-white/82 p-5 shadow-[0_20px_40px_rgba(15,23,42,0.06)] backdrop-blur-2xl">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.26em] text-neutral-400">
                        Runtime
                      </div>
                      <div className="mt-4 space-y-4">
                        <div>
                          <div className="text-2xl font-semibold tracking-[-0.04em]">5s</div>
                          <div className="text-xs text-neutral-500">市场同步周期</div>
                        </div>
                        <div>
                          <div className="text-2xl font-semibold tracking-[-0.04em]">JSON</div>
                          <div className="text-xs text-neutral-500">结构化决策输出</div>
                        </div>
                        <div>
                          <div className="text-2xl font-semibold tracking-[-0.04em]">SWR</div>
                          <div className="text-xs text-neutral-500">前端准实时刷新</div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="apple-floating-card apple-floating-card-left">
                Worker 持续同步市场并重估账户
              </div>
              <div className="apple-floating-card apple-floating-card-right">
                LLM 输出被约束成可执行交易 JSON
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 pb-8 sm:px-10">
        <div className="grid gap-5 lg:grid-cols-3">
          {sections.map((item, index) => (
            <div
              key={item.title}
              data-reveal
              className="apple-section-card reveal-up rounded-[34px] border border-neutral-200/80 bg-white/78 p-7 shadow-[0_25px_60px_rgba(15,23,42,0.06)] backdrop-blur-2xl"
              style={{ transitionDelay: `${index * 120}ms` }}
            >
              <div className="text-[11px] font-semibold uppercase tracking-[0.3em] text-neutral-400">
                {item.eyebrow}
              </div>
              <h2 className="mt-5 text-2xl font-semibold tracking-[-0.04em] text-neutral-950">
                {item.title}
              </h2>
              <p className="mt-4 text-[15px] leading-7 text-neutral-600">
                {item.body}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 py-16 sm:px-10">
        <div className="grid gap-10 lg:grid-cols-[0.9fr_1.1fr]">
          <div
            data-reveal
            className="reveal-up rounded-[36px] border border-neutral-200/80 bg-[linear-gradient(180deg,#ffffff,rgba(245,247,250,0.92))] p-8 shadow-[0_30px_70px_rgba(15,23,42,0.06)]"
          >
            <div className="text-[11px] font-semibold uppercase tracking-[0.3em] text-neutral-400">
              Workflow
            </div>
            <h2 className="mt-5 text-4xl font-semibold leading-tight tracking-[-0.05em]">
              一条完整的数据闭环。
            </h2>
            <p className="mt-5 max-w-xl text-[16px] leading-8 text-neutral-600">
              从行情进入，到模型决策、模拟执行、账户核算，再到前端图表与日志流展示，每个环节都是独立模块，不是堆在同一个页面里的静态演示。
            </p>
          </div>

          <div
            data-reveal
            className="reveal-up rounded-[36px] border border-neutral-200/80 bg-white/78 p-8 shadow-[0_30px_70px_rgba(15,23,42,0.06)] backdrop-blur-2xl"
            style={{ transitionDelay: "120ms" }}
          >
            <div className="space-y-6">
              {flow.map((item, index) => (
                <div key={item} className="flex items-start gap-4">
                  <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-neutral-950 text-xs font-semibold text-white">
                    {index + 1}
                  </div>
                  <p className="text-[15px] leading-7 text-neutral-700">{item}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="px-6 pb-20 sm:px-10">
        <div
          data-reveal
          className="reveal-up mx-auto max-w-6xl rounded-[40px] border border-neutral-200/80 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.95),rgba(242,245,249,0.92))] px-8 py-14 text-center shadow-[0_35px_90px_rgba(15,23,42,0.08)]"
        >
          <div className="text-[11px] font-semibold uppercase tracking-[0.32em] text-neutral-400">
            Ready To Explore
          </div>
          <h2 className="mt-5 text-4xl font-semibold tracking-[-0.05em] sm:text-5xl">
            把模型放进真实运行环境。
          </h2>
          <p className="mx-auto mt-5 max-w-2xl text-[16px] leading-8 text-neutral-600">
            登录后你可以直接查看基准线、创建模型、切换提示词模板，并观察每一轮决策如何影响账户权益曲线。
          </p>
          <div className="mt-10 flex flex-col justify-center gap-4 sm:flex-row">
            <Link
              href="/auth/login"
              className="apple-primary-btn inline-flex items-center justify-center rounded-full px-7 py-3.5 text-sm font-semibold text-white"
            >
              登录进入
            </Link>
            <Link
              href="/auth/guest"
              className="inline-flex items-center justify-center rounded-full border border-neutral-300/80 bg-white px-7 py-3.5 text-sm font-semibold text-neutral-800 transition hover:border-neutral-400"
            >
              游客查看
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
