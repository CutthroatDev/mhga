import type { NavItem } from '@/types';

export const siteConfig = {
  // Placeholder name; replace when branding is decided.
  name: 'Halloween Site',
  description:
    'A curated destination for Halloween decorations, costumes, and creative projects worth buying or building.',
  // PLACEHOLDER: final wording to be written before any affiliate links go live.
  affiliateDisclosure:
    'Placeholder disclosure: some links on this site may become affiliate links, which could earn a commission at no extra cost to you. Final wording to come.',
} as const;

/**
 * Public site navigation. The future /admin area is intentionally NOT listed here.
 */
export const navItems: NavItem[] = [
  { label: 'Home', href: '/' },
  {
    label: 'Decorations',
    href: '/decorations',
    description: 'Outdoor and indoor pieces that set the scene.',
    children: [
      {
        label: 'Outdoor',
        href: '/decorations/outdoor',
        description: 'Yard, porch, and front-door decorations.',
      },
      {
        label: 'Indoor',
        href: '/decorations/indoor',
        description: 'Decorations for mantels, tables, and walls.',
      },
      {
        label: 'Products',
        href: '/decorations/products',
        description: 'Every decoration in one place.',
      },
    ],
  },
  {
    label: 'Costumes',
    href: '/costumes',
    description: 'Costumes for trick-or-treating, parties, and everything between.',
    children: [
      {
        label: 'Products',
        href: '/costumes/products',
        description: 'Every costume in one place.',
      },
    ],
  },
  {
    label: 'DIY Projects',
    href: '/diy-projects',
    description: 'Halloween projects worth building yourself.',
  },
  { label: 'About', href: '/about' },
];

export function getNavChildren(href: string): NavItem[] {
  return navItems.find((item) => item.href === href)?.children ?? [];
}
