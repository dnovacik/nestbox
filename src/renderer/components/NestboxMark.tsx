import Mark from '@brand/svg/nestbox-mark.svg?react';
import { cn } from '@/lib/utils';

/** The Nestbox mark (resources/brand/svg/nestbox-mark.svg), recoloured to theme tokens. */
export function NestboxMark({ className }: { className?: string }) {
  return <Mark aria-hidden className={cn('[&_#hole]:fill-brand [&_#mark]:fill-fg', className)} />;
}
