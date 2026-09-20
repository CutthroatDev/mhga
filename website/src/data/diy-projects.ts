import type { DIYProject } from '@/types';

// STATIC DIY CONTENT (placeholder). DIY projects are NOT in D1 yet: the public site reads this file
// through src/data-access/diy-projects.ts. (The D1 schema and repository for DIY projects exist and
// are seeded, but the public site does not use them yet.)
//
// Related products are referenced by SLUG and resolved live through the public product catalog,
// which applies the visibility rules. Never copy product data into this file.
export const diyProjects: DIYProject[] = [
  {
    id: 'sample-diy-1',
    slug: 'sample-paper-bats',
    title: 'Sample Paper Bats',
    summary: 'Placeholder DIY project.',
    difficulty: 'easy',
    estimatedTime: '30 minutes',
    materials: ['Black paper', 'Scissors', 'Tape'],
    steps: ['Cut out bat shapes.', 'Tape them to a wall.'],
    relatedProductSlugs: ['sample-porch-skeleton'],
    published: true,
  },
];
