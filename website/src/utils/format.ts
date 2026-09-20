import type { ProductPrice } from '@/types';

export function formatPrice(price?: ProductPrice): string | undefined {
  if (!price) return undefined;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: price.currency,
  }).format(price.amount);
}
