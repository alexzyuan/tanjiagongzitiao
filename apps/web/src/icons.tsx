import type { ReactNode } from "react";

export function Icon({ name, size = 18 }: { name: "wallet" | "receipt" | "chart" | "lock" | "settings" | "upload" | "plus" | "send" | "refresh" | "withdraw" | "download" | "search" | "check" | "shield" | "users"; size?: number }) {
  const paths: Record<string, ReactNode> = {
    wallet: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M7 5V3h10v2" /><path d="M16 12h5" /><circle cx="16" cy="12" r="1" /></>,
    receipt: <><path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z" /><path d="M9 8h6M9 12h6M9 16h3" /></>,
    chart: <><path d="M4 19V5M4 19h16" /><rect x="7" y="12" width="2.8" height="5" rx=".5" /><rect x="11.5" y="9" width="2.8" height="8" rx=".5" /><rect x="16" y="6" width="2.8" height="11" rx=".5" /></>,
    lock: <><rect x="4" y="10" width="16" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3" /></>,
    settings: <><path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z" /><path d="m19.4 15 .1.1a2 2 0 0 1-2.8 2.8l-.1-.1-1.1.6-.1.2a2 2 0 0 1-4 0v-.2l-1.1-.6-.1.1a2 2 0 0 1-2.8-2.8l.1-.1-.6-1.1H6.7a2 2 0 0 1 0-4h.2l.6-1.1-.1-.1a2 2 0 0 1 2.8-2.8l.1.1 1.1-.6v-.2a2 2 0 0 1 4 0v.2l1.1.6.1-.1a2 2 0 0 1 2.8 2.8l-.1.1.6 1.1h.2a2 2 0 0 1 0 4h-.2l-.6 1.1Z" /></>,
    upload: <><path d="M12 16V4" /><path d="m7 9 5-5 5 5" /><path d="M4 14v5h16v-5" /></>,
    plus: <><path d="M12 5v14M5 12h14" /></>,
    send: <><path d="m21 3-7.2 18-3.5-7.3L3 10.2 21 3Z" /><path d="M10.3 13.7 21 3" /></>,
    refresh: <><path d="M20 11a8 8 0 0 0-14.8-4L3 10" /><path d="M3 5v5h5M4 13a8 8 0 0 0 14.8 4L21 14" /><path d="M21 19v-5h-5" /></>,
    withdraw: <><path d="M5 5h14v14H5z" /><path d="m8 8 8 8M16 8l-8 8" /></>,
    download: <><path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M4 19h16" /></>,
    search: <><circle cx="10.8" cy="10.8" r="6.8" /><path d="m16 16 5 5" /></>,
    check: <><path d="m5 12 4 4L19 6" /></>,
    shield: <><path d="M12 3 20 6v5c0 5-3.4 8.6-8 10-4.6-1.4-8-5-8-10V6l8-3Z" /><path d="m8 12 2.5 2.5L16 9" /></>,
    users: <><path d="M16 20v-1.5a4.5 4.5 0 0 0-4.5-4.5h-3A4.5 4.5 0 0 0 4 18.5V20" /><circle cx="10" cy="7" r="3" /><path d="M16 4.5a3 3 0 0 1 0 5.8M19.5 20v-1.5a4.5 4.5 0 0 0-2.2-3.9" /></>
  };
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}
