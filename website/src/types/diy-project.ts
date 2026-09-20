export type DIYDifficulty = 'easy' | 'medium' | 'hard';

export interface DIYProject {
  id: string;
  /** URL segment: /diy-projects/<slug> */
  slug: string;
  title: string;
  summary: string;
  difficulty: DIYDifficulty;
  /** Free-form for now, e.g. "2 hours". */
  estimatedTime?: string;
  imageUrl?: string;
  imageAlt?: string;
  materials: string[];
  steps: string[];
  /** Ids of approved products that pair with this project. Unapproved ids are ignored. */
  relatedProductIds?: string[];
  /** Unpublished projects are never shown publicly. */
  published: boolean;
}
