import { diyProjects } from '@/data/diy-projects';
import type { DIYProject } from '@/types';

export async function getPublishedDIYProjects(limit?: number): Promise<DIYProject[]> {
  const published = diyProjects.filter((project) => project.published);
  return limit === undefined ? published : published.slice(0, limit);
}

export async function getPublishedDIYProjectBySlug(slug: string): Promise<DIYProject | undefined> {
  return (await getPublishedDIYProjects()).find((project) => project.slug === slug);
}

/** Other published projects. */
export async function getRelatedDIYProjects(project: DIYProject, limit = 3): Promise<DIYProject[]> {
  return (await getPublishedDIYProjects())
    .filter((other) => other.id !== project.id)
    .slice(0, limit);
}
