# Halloween Site

A website of curated Halloween products (decorations and costumes) from outside
retailers, plus DIY project guides. This repository currently contains only the
project scaffold: placeholder pages, reusable components, data models, and a
neutral layout. The final design and real content come later.

## Technology stack

- [Astro](https://astro.build) 5 (static output, file-based routing)
- TypeScript (strict)
- HTML and plain CSS (no CSS framework)
- Deployment: **Cloudflare** (Workers static assets, configured in `wrangler.jsonc`)

No PHP, database, scraping, affiliate integration, or authentication exists yet.

## Getting started

Requires Node.js 20.3 or newer (`.nvmrc` pins 22).

```sh
npm install        # install dependencies
npm run dev        # start the dev server at http://localhost:4321
npm run build      # build the static site into dist/
npm run preview    # serve the built site locally
npm run check      # type-check .astro and .ts files
```

## Deployment

Cloudflare is the intended deployment platform. Either:

- `npm run deploy` (builds, then runs `wrangler deploy`; requires `wrangler login`), or
- connect the repo in the Cloudflare dashboard with build command `npm run build`
  and output directory `dist`.

## Routes

| Route                              | Purpose                     |
| ---------------------------------- | --------------------------- |
| `/`                                | Home                        |
| `/decorations`                     | Decorations overview        |
| `/decorations/outdoor`             | Outdoor decorations         |
| `/decorations/indoor`              | Indoor decorations          |
| `/decorations/products`            | All decoration products     |
| `/decorations/products/<slug>`     | Decoration product detail   |
| `/costumes`                        | Costumes overview           |
| `/costumes/products`               | All costume products        |
| `/costumes/products/<slug>`        | Costume product detail      |
| `/diy-projects`                    | DIY projects list           |
| `/diy-projects/<slug>`             | DIY project detail          |
| `/about`                           | About                       |

A future private `/admin` area is planned but not built or linked (see `src/admin/README.md`).

## Cute / Scary theme

The header toggle switches the site's *decorative atmosphere* only. It never filters
or changes products, categories, or content.

- **State:** one attribute on `<html>`: `data-halloween-theme="cute" | "scary"`
  (default `cute`, set in the server-rendered HTML).
- **Styling:** `src/styles/tokens.css` holds content tokens (identical in both themes, so
  content stays readable). `src/styles/theme.css` overrides atmosphere tokens
  (`--band-*`, `--deco-*`, `--page-bg`) per theme.
- **Persistence:** the choice is saved in `localStorage` (key `halloween-theme`). A tiny
  inline script in `BaseLayout` applies it before first paint (no flash). If storage is
  blocked, the choice still works for the current page. No account needed.
- **JavaScript:** the toggle script (`ThemeToggle.astro`) and the mobile menu script
  (`SiteHeader.astro`) are the only client JS. The toggle is hidden when JS is off.

## Decorations

Decorative characters live in `src/components/decor/` as small inline SVG placeholders.
Each component renders a Cute and a Scary variant, and CSS shows the active one
(`.only-cute` / `.only-scary`), so there is never a second copy of a page.

- `Decor.astro` positions a piece (corner, size, offset, hide-on-mobile, motion).
- `HeadingDecor.astro` chooses the piece for each page heading.
- Decor is `aria-hidden`, sits behind content, ignores the pointer, is absolutely
  positioned (no layout shift), is mostly hidden below 48rem, and animates only when the
  user has not requested reduced motion.
- Real artwork goes in `src/assets/decorations/{shared,cute,scary}/` (see its README).

## Folder structure

```
public/                 Static files served as-is (favicon, etc.)
src/
  admin/                Placeholder for the future /admin area (README only)
  assets/images/        Images processed by the build
  assets/decorations/   Future decorative artwork: shared/, cute/, scary/
  components/
    layout/             Header, footer, logo, theme toggle, sections, page header, sub-nav
    ui/                 Shared primitives (Button, Badge, EmptyState, LinkTile, ...)
    decor/              Decorative SVG pieces and the Decor placement wrapper
    home/               Homepage sections (Hero, Philosophy)
    products/           ProductCard, ProductGrid, ProductShelf, ProductDetail
    categories/         CategoryPage (template for product listing pages)
    diy/                DIY project card, grid, and detail
  config/               Site name and navigation
  data/                 Placeholder sample data (replaced by a real source later)
  data-access/          The only layer pages use to read products/projects
  layouts/              BaseLayout (document shell)
  pages/                Routes (file-based)
  server/               Placeholder for future ingestion/review/API code (README only)
  styles/               tokens.css, theme.css (Cute/Scary), decor.css, global.css
  types/                TypeScript models (Product, Retailer, DIYProject, ...)
  utils/                Small helpers (route builders, formatting)
```

## Key conventions

- Pages and components never import from `src/data/` directly; they use `src/data-access/`.
- The public data-access layer returns **approved** products only.
- Product review status is `pending`, `approved`, or `rejected`.

See `AGENTS.md` for guidance for coding agents.
