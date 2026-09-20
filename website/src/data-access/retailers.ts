import { retailers } from '@/data/retailers';
import type { Retailer } from '@/types';

export async function getRetailerById(id: string): Promise<Retailer | undefined> {
  return retailers.find((retailer) => retailer.id === id);
}
