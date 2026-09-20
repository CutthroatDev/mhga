import { defineMiddleware } from 'astro:middleware';
import { isAdminPath, localAdminDenied } from './server/admin/access';

/**
 * Guards the entire admin area (pages under /admin and endpoints under /api/admin) in one
 * place, before any admin code runs. In production builds every such request gets a 404.
 *
 * Admin pages and endpoints ALSO check the guard themselves (defense in depth).
 * Public pages are not affected.
 *
 * Note: middleware only runs for on-demand routes. An admin route that was accidentally
 * prerendered would bypass it, which is why astro.config.mjs fails the build if any admin
 * page is prerendered.
 */
export const onRequest = defineMiddleware((context, next) => {
  if (isAdminPath(context.url.pathname)) {
    const denied = localAdminDenied(context.request);
    if (denied) return denied;
  }
  return next();
});
