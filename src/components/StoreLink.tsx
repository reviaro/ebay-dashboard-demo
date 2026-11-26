'use client';
import Link from 'next/link';
import type { ComponentProps } from 'react';
import { storeUrl } from '@/lib/stores/browser';

export default function StoreLink(props: ComponentProps<typeof Link>) {
  return <Link {...props} href={typeof props.href === 'string' ? storeUrl(props.href) : props.href} />;
}
