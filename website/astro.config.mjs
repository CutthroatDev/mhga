import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';

/**
 * Safety net for the local-only admin. Request-time guards (src/middleware.ts and
 * src/server/admin/access.ts) only run for on-demand routes. A prerendered page is a
 * plain file served to everyone, so an admin page that lost its `prerender = false` would
 * be public. Fail the build if that ever happens.
 */
const forbidPrerenderedAdmin = {
  name: 'forbid-prerendered-admin',
  hooks: {
    'astro:build:done': ({ pages }) => {
      const leaked = pages
        .map((page) => page.pathname)
        .filter((pathname) => /^\/?(api\/)?admin(\/|$)/i.test(pathname));
      if (leaked.length > 0) {
        throw new Error(
          `Admin pages must never be prerendered (they would be publicly readable): ${leaked.join(', ')}. ` +
            'Add `export const prerender = false;` to each admin route.',
        );
      }
    },
  },
};

// Hybrid: pages are prerendered (static) by default. Only routes that opt out with
// `export const prerender = false` (e.g. src/pages/api/health.ts, the admin) run in the Worker.
//
// @astrojs/cloudflare v12 is the line that supports Astro 5. Its runtime API is
// `Astro.locals.runtime.env` (see src/env.d.ts). Do not use Astro 6 APIs such as
// `import { env } from 'cloudflare:workers'`.
//
// In `astro dev`, bindings (including D1) come from Wrangler's LOCAL simulation, stored
// in .wrangler/state. Dev never connects to the remote database.
export default defineConfig({
  output: 'static',
  // 'compile': images on prerendered pages are optimized at build time; nothing is
  // transformed at runtime (Cloudflare Workers cannot run sharp).
  adapter: cloudflare({ imageService: 'compile' }),
  integrations: [forbidPrerenderedAdmin],
});
