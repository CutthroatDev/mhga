import type { Product } from '@/types';

// PLACEHOLDER SAMPLE DATA so routes and components can be exercised.
// Replace with a real data source later; the data-access layer in
// src/data-access/ is the only code that should read from this file.
// The "pending" entry exists to demonstrate that unapproved products stay hidden.
export const products: Product[] = [
  {
    id: 'sample-1',
    slug: 'sample-porch-skeleton',
    section: 'decorations',
    name: 'Sample Porch Skeleton',
    summary: 'Placeholder outdoor decoration.',
    description: 'Placeholder product used to exercise the product detail layout.',
    categorySlugs: ['outdoor'],
    price: { amount: 24.99, currency: 'USD' },
    retailerId: 'example-retailer',
    sourceUrl: 'https://example.com/',
    reviewStatus: 'approved',
    badges: ['Sample badge'],
    qualityNotes: ['Placeholder note about materials and construction.'],
    details: [{ label: 'Size', value: 'Placeholder' }],
  },
  {
    id: 'sample-2',
    slug: 'sample-pending-candle',
    section: 'decorations',
    name: 'Sample Pending Candle',
    summary: 'Not approved, so it must not appear anywhere on the public site.',
    categorySlugs: ['indoor'],
    retailerId: 'example-retailer',
    sourceUrl: 'https://example.com/',
    reviewStatus: 'pending',
  },
  {
    id: 'sample-3',
    slug: 'sample-witch-hat',
    section: 'costumes',
    name: 'Sample Witch Hat',
    summary: 'Placeholder costume product.',
    categorySlugs: [],
    price: { amount: 12.5, currency: 'USD' },
    retailerId: 'example-retailer',
    sourceUrl: 'https://example.com/',
    reviewStatus: 'approved',
  },
];
