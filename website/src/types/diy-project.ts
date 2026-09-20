export type DIYDifficulty = 'easy' | 'medium' | 'hard';

export interface DIYProject {
  id: string;
  /** URL segment: /diy-projects/<slug> */
  slug: string;
  title: string;
  summary: string;
  /** Optional long-form content, reserved for later. */
  body?: string;
  difficulty: DIYDifficulty;
  /** Free-form for now, e.g. "2 hours". */
  estimatedTime?: string;
  imageUrl?: string;
  imageAlt?: string;
  materials: string[];
  steps: string[];
  /**
   * Slugs of products that pair with this project, in display order. They are resolved
   * through the public product read path, so hidden (pending/rejected/ineligible) products
   * are silently skipped and can never appear.
   */
  relatedProductSlugs?: string[];
  /** Unpublished projects are never shown publicly. */
  published: boolean;
}
