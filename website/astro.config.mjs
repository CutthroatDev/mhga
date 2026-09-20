import { defineConfig } from 'astro/config';

// Static output for now. When the /admin area is added, switch the relevant
// routes to on-demand rendering with the @astrojs/cloudflare adapter
// (see src/admin/README.md).
export default defineConfig({
  output: 'static',
});
