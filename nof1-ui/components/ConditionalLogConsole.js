"use client";

import { usePathname } from "next/navigation";
import LogConsole from "./LogConsole";

export default function ConditionalLogConsole() {
  const pathname = usePathname();
  const enabled =
    pathname?.startsWith("/dashboard") ||
    pathname?.startsWith("/models") ||
    pathname?.startsWith("/settings");
  if (!enabled) return null;
  return <LogConsole />;
}
