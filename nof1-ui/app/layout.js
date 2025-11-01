export const metadata = {
  title: 'Alpha Arena 模拟界面 | FINAI',
  description: '基于 Next.js 的 Alpha Arena 前端演示，用于人机协同交易研究界面。',
};

import './globals.css';

export default function RootLayout({ children }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body className="min-h-screen bg-neutral-50 text-neutral-900">
        {children}
      </body>
    </html>
  );
}
