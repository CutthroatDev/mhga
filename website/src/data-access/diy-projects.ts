import { diyProjects } from '@/data/diy-projects';
import type { DIYProject } from '@/types';

export async function getPublishedDIYProjects(): Promise<DIYProject[]> {
  return diyProjects.filter((project) => project.published);
}

export async function getPublishedDIYProjectBySlug(slug: string): Promise<DIYProject | undefined> {
  return (await getPublishedDIYProjects()).find((project) => project.slug === slug);
}
