# Decorative assets

Home for future custom decorative artwork (SVG, WebP, etc.). Keep it separate from
product imagery: product and project images come from data, never from this folder.

```
shared/   used in both themes (cobwebs, stars, textures)
cute/     Cute mode only (friendly ghosts, smiling pumpkins, candy)
scary/    Scary mode only (eerie ghosts, skeletal hands, creepy eyes)
```

Today the decorations are small inline SVG components in `src/components/decor/`
(placeholders). To swap in real artwork:

1. Add the file to the matching folder here.
2. In the component (e.g. `Ghost.astro`), replace the `<svg class="only-cute">` /
   `<svg class="only-scary">` with `<img>` (or an imported SVG) using the same
   `only-cute` / `only-scary` class, and keep `alt=""` since decoration is not content.
3. Placement and motion stay in `Decor.astro` and `src/styles/decor.css`.
