export type ModuleId = 'archive' | 'scripture' | 'watchtower' | 'lifeline' | 'settings';

export interface ModuleDefinition {
  id: ModuleId;
  label: string;
  /** `planned` modules render a clearly labeled placeholder instead of working features. */
  status: 'available' | 'planned';
  tagline: string;
}

export const MODULES: readonly ModuleDefinition[] = [
  { id: 'archive', label: 'Archive', status: 'available', tagline: 'Documents & notes' },
  { id: 'scripture', label: 'Scripture', status: 'available', tagline: 'Read & reference' },
  { id: 'watchtower', label: 'Watchtower', status: 'planned', tagline: 'Events & evidence' },
  { id: 'lifeline', label: 'Lifeline', status: 'planned', tagline: 'Preparedness references' },
  { id: 'settings', label: 'Settings', status: 'available', tagline: 'About & data' },
];
