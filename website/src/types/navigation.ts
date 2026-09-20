export interface NavItem {
  label: string;
  href: string;
  description?: string;
  children?: NavItem[];
}
