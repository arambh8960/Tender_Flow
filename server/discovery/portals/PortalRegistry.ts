import type { ProcurementPortalAdapter } from './PortalAdapter';
import { GeMAdapter } from './gem/GeMAdapter';

type AdapterFactory = () => ProcurementPortalAdapter;

/**
 * Portal lookup. Adding a portal is a registry entry plus an adapter —
 * the coordinator does not change.
 */
const REGISTRY: Record<string, AdapterFactory> = {
  gem: () => new GeMAdapter(),
  // cppp: () => new CPPPAdapter(),
};

export function createAdapter(portal: string): ProcurementPortalAdapter {
  const factory = REGISTRY[portal.toLowerCase()];
  if (!factory) {
    throw new Error(`Portal "${portal}" is not supported. Available: ${listPortals().join(', ')}`);
  }
  return factory();
}

export function listPortals(): string[] {
  return Object.keys(REGISTRY);
}

export function isPortalSupported(portal: string): boolean {
  return Object.prototype.hasOwnProperty.call(REGISTRY, portal.toLowerCase());
}
