import type { ReactNode } from 'react';
import { TopBar } from './TopBar';

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex min-h-full flex-col">
      <TopBar />
      <main className="flex-1 pb-16">
        <div className="container max-w-6xl py-10">{children}</div>
      </main>
      <footer className="border-t border-emerald-100/70 py-5">
        <div className="container max-w-6xl text-center text-xs text-muted-foreground">
          OverScore · data by TheSportsDB · AI by OpenRouter · not gambling advice
        </div>
      </footer>
    </div>
  );
}
