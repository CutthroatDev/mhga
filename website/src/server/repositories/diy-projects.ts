import type { DIYProject, ProductListItem } from '../../types';
import type { Database } from '../db/database';
import type { DIYProjectRow } from '../db/rows';
import { mapPublicDIYProject } from './mappers';
import type { PublicProductRepository } from './public-products';

const COLUMNS = `id, slug, title, summary, body, materials_json, steps_json,
  difficulty, estimated_time, image_url, image_alt, status`;

/**
 * PUBLIC DIY project reads: published projects only, and only their approved products.
 * (Authoring/editing projects is a later admin feature and is not built yet.)
 */
export class DIYProjectRepository {
  constructor(
    private readonly db: Database,
    private readonly products: PublicProductRepository,
  ) {}

  async getPublishedProjects(limit?: number): Promise<DIYProject[]> {
    const rows = await this.db.all<DIYProjectRow>(
      `SELECT ${COLUMNS} FROM diy_projects WHERE status = 'published' ORDER BY created_at DESC, id ASC`,
    );
    const links = await this.getApprovedProductIdsByProject();
    const projects = rows.map((row) => mapPublicDIYProject(row, links.get(row.id) ?? []));
    return limit === undefined ? projects : projects.slice(0, limit);
  }

  async getPublishedProjectBySlug(slug: string): Promise<DIYProject | undefined> {
    const row = await this.db.first<DIYProjectRow>(
      `SELECT ${COLUMNS} FROM diy_projects WHERE status = 'published' AND slug = ?`,
      slug,
    );
    if (!row) return undefined;
    const links = await this.getApprovedProductIdsByProject();
    return mapPublicDIYProject(row, links.get(row.id) ?? []);
  }

  /** Approved products a project uses, in the project's deliberate order. */
  async getProductsForProject(projectId: string): Promise<ProductListItem[]> {
    return this.products.getApprovedProductsForProject(projectId);
  }

  /** project id -> approved product ids in order, for published projects. One query. */
  private async getApprovedProductIdsByProject(): Promise<Map<string, string[]>> {
    const rows = await this.db.all<{ project_id: string; product_id: string }>(
      `SELECT l.project_id, l.product_id
       FROM diy_project_products l
       JOIN diy_projects d ON d.id = l.project_id AND d.status = 'published'
       JOIN products p ON p.id = l.product_id AND p.review_status = 'approved'
       ORDER BY l.project_id, l.sort_order, l.product_id`,
    );
    const byProject = new Map<string, string[]>();
    for (const row of rows) {
      byProject.set(row.project_id, [...(byProject.get(row.project_id) ?? []), row.product_id]);
    }
    return byProject;
  }
}
