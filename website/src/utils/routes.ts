import type { ProductSection } from '@/types';

export function productPath(section: ProductSection, slug: string): string {
  return `/${section}/products/${slug}`;
}

export function diyProjectPath(slug: string): string {
  return `/diy-projects/${slug}`;
}

/** True when `currentPath` is `href` or nested beneath it. Ignores trailing slashes. */
export function isActivePath(currentPath: string, href: string): boolean {
  const normalize = (path: string) => (path.length > 1 ? path.replace(/\/+$/, '') : path);
  const current = normalize(currentPath);
  const target = normalize(href);
  if (target === '/') return current === '/';
  return current === target || current.startsWith(`${target}/`);
}
