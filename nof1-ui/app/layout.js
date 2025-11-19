export const metadata = {
  title: 'FINAI',
  description: '基于多模型的炒币系统',
};

import './globals.css';
import LogConsole from '../components/LogConsole';

export default function RootLayout({ children }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body className="min-h-screen bg-neutral-50 text-neutral-900">
        <LogConsole />
        {children}
      </body>
    </html>
  );
}
