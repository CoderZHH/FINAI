"use client";

import Link from "next/link";

export default function Header() {
  return (
    <header className="sticky top-0 z-40 border-b bg-white/90 backdrop-blur supports-[backdrop-filter]:bg-white/60">
      <div className="mx-auto max-w-[1920px] px-4">
        <div className="flex h-14 items-center justify-between gap-6">
          <div className="flex items-center gap-6">
            <Link href="/" className="text-xl font-black tracking-tight">
              Alpha Arena 实验台
            </Link>
            <nav className="hidden items-center gap-6 text-sm md:flex">
              <Link className="hover:underline" href="/live">
                实盘
              </Link>
              <Link className="hover:underline" href="/leaderboard">
                排行榜
              </Link>
              <a className="hover:underline" href="#">
                博客
              </a>
              <Link className="hover:underline" href="/models">
                模型库
              </Link>
            </nav>
          </div>
          <div className="flex items-center gap-4 text-xs">
            <a className="hover:underline" href="#">
              加入候补
            </a>
            <a className="hover:underline" href="#">
              关于平台
            </a>
          </div>
        </div>
      </div>
    </header>
  );
}
