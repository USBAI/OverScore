import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:ring-offset-1',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-emerald-500 text-white',
        secondary: 'border-transparent bg-emerald-50 text-emerald-800',
        destructive: 'border-transparent bg-rose-500 text-white',
        outline: 'border-emerald-200 bg-white/60 text-emerald-800',
        live: 'border-transparent bg-gradient-to-r from-rose-500 to-orange-500 text-white animate-pulse-live',
        over: 'border-transparent bg-emerald-500/15 text-emerald-700',
        under: 'border-transparent bg-rose-500/15 text-rose-600',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}
