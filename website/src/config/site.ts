import type { NavItem } from '@/types';

export const siteConfig = {
  // Placeholder name; replace when branding is decided.
  name: 'Halloween Site',
  description: 'Curated Halloween decorations, costumes, and DIY projects.',
} as const;

/**
 * Public site navigation. The future /admin area is intentionally NOT listed here.
 */
export const navItems: NavItem[] = [
  { label: 'Home', href: '/' },
  {
    label: 'Decorations',
    href: '/decorations',
    description: 'Outdoor and indoor Halloween decorations.',
    children: [
      { label: 'Outdoor', href: '/decorations/outdoor' },
      { label: 'Indoor', href: '/decorations/indoor' },
      { label: 'Products', href: '/decorations/products' },
    ],
  },
  {
    label: 'Costumes',
    href: '/costumes',
    description: 'Halloween costumes for everyone.',
    children: [{ label: 'Products', href: '/costumes/products' }],
  },
  {
    label: 'DIY Projects',
    href: '/diy-projects',
    description: 'Make your own Halloween decorations and costumes.',
  },
  { label: 'About', href: '/about' },
];

export function getNavChildren(href: string): NavItem[] {
  return navItems.find((item) => item.href === href)?.children ?? [];
}
