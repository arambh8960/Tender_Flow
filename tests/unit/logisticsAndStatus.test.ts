import { describe, it, expect } from 'vitest';
import {
  haversineKm,
  roadDistanceKm,
  resolveLocation,
  selectNearestWarehouse,
  isUsableCoordinate,
} from '../../server/services/logistics/geo';
import { canTransition, ANALYSIS_STATUSES, type AnalysisStatus } from '../../server/repositories/analysisRepository';

/**
 * Geospatial distance and the RFP status machine — the two pieces of shared
 * logic that the rest of the system treats as ground truth.
 */

const JALANDHAR = { latitude: 31.326, longitude: 75.5762 };
const CHENNAI = { latitude: 13.0827, longitude: 80.2707 };
const LUDHIANA = { latitude: 30.901, longitude: 75.8573 };

describe('geospatial distance', () => {
  it('measures a known long-haul distance within a sensible margin', () => {
    // Jalandhar to Chennai is roughly 2,100 km as the crow flies.
    const distance = haversineKm(JALANDHAR, CHENNAI);
    expect(distance).toBeGreaterThan(2_000);
    expect(distance).toBeLessThan(2_300);
  });

  it('measures a short haul', () => {
    const distance = haversineKm(JALANDHAR, LUDHIANA);
    expect(distance).toBeGreaterThan(30);
    expect(distance).toBeLessThan(70);
  });

  it('returns zero for identical points', () => {
    expect(haversineKm(JALANDHAR, JALANDHAR)).toBe(0);
  });

  it('is symmetric', () => {
    expect(haversineKm(JALANDHAR, CHENNAI)).toBe(haversineKm(CHENNAI, JALANDHAR));
  });

  it('inflates the straight line into a road distance', () => {
    expect(roadDistanceKm(JALANDHAR, LUDHIANA)).toBeGreaterThan(haversineKm(JALANDHAR, LUDHIANA));
  });

  it('is deterministic across repeated calls', () => {
    const first = roadDistanceKm(JALANDHAR, CHENNAI);
    for (let i = 0; i < 5; i++) expect(roadDistanceKm(JALANDHAR, CHENNAI)).toBe(first);
  });

  it('treats a zero coordinate as unusable rather than as the Gulf of Guinea', () => {
    expect(isUsableCoordinate(0)).toBe(false);
    expect(isUsableCoordinate(31.326)).toBe(true);
    expect(isUsableCoordinate(Number.NaN)).toBe(false);
  });
});

describe('location resolution', () => {
  it('resolves a city with city-level precision', () => {
    const resolved = resolveLocation('Ludhiana, Punjab');
    expect(resolved?.precision).toBe('city');
    expect(resolved?.matchedOn).toBe('ludhiana');
  });

  it('prefers the city when both a city and its state are named', () => {
    expect(resolveLocation('Chennai, Tamil Nadu')?.matchedOn).toBe('chennai');
  });

  it('falls back to state-level precision when only a state is named', () => {
    const resolved = resolveLocation('Somewhere in Kerala');
    expect(resolved?.precision).toBe('state');
    expect(resolved?.matchedOn).toBe('kerala');
  });

  it('returns null for an unrecognised place rather than guessing', () => {
    expect(resolveLocation('Block C, Sector 9 Extension')).toBeNull();
    expect(resolveLocation('')).toBeNull();
    expect(resolveLocation(null)).toBeNull();
    expect(resolveLocation(undefined)).toBeNull();
  });

  it('does not match a place name embedded inside another word', () => {
    // "goa" must not match inside "goalpara".
    expect(resolveLocation('Goalpara district')?.matchedOn).not.toBe('goa');
  });

  it('distinguishes New Delhi from Delhi', () => {
    expect(resolveLocation('New Delhi')?.matchedOn).toBe('new delhi');
  });

  it('is deterministic', () => {
    const first = JSON.stringify(resolveLocation('Coimbatore, Tamil Nadu'));
    for (let i = 0; i < 3; i++) expect(JSON.stringify(resolveLocation('Coimbatore, Tamil Nadu'))).toBe(first);
  });
});

describe('warehouse selection', () => {
  const warehouses = [
    { code: 'WH-JAL', location: 'Jalandhar, Punjab', coordinates: JALANDHAR },
    { code: 'WH-CHN', location: 'Chennai, Tamil Nadu', coordinates: CHENNAI },
  ];

  it('picks the nearest warehouse to the destination', () => {
    expect(selectNearestWarehouse(LUDHIANA, warehouses)?.warehouse.code).toBe('WH-JAL');
    expect(selectNearestWarehouse(CHENNAI, warehouses)?.warehouse.code).toBe('WH-CHN');
  });

  it('reports the distance to the selected warehouse', () => {
    const selection = selectNearestWarehouse(LUDHIANA, warehouses);
    expect(selection?.distanceKm).toBeGreaterThan(0);
    expect(selection?.distanceKm).toBeLessThan(120);
  });

  it('skips warehouses with no coordinates instead of assuming a location', () => {
    const selection = selectNearestWarehouse(LUDHIANA, [
      { code: 'WH-UNKNOWN', location: 'Unlisted', coordinates: null },
      { code: 'WH-CHN', location: 'Chennai', coordinates: CHENNAI },
    ]);
    expect(selection?.warehouse.code).toBe('WH-CHN');
  });

  it('returns null when no warehouse can be measured from', () => {
    expect(selectNearestWarehouse(LUDHIANA, [{ code: 'WH-X', location: '', coordinates: null }])).toBeNull();
    expect(selectNearestWarehouse(LUDHIANA, [])).toBeNull();
  });

  it('breaks ties on warehouse code so selection is reproducible', () => {
    const tied = [
      { code: 'WH-B', location: 'B', coordinates: JALANDHAR },
      { code: 'WH-A', location: 'A', coordinates: JALANDHAR },
    ];
    expect(selectNearestWarehouse(LUDHIANA, tied)?.warehouse.code).toBe('WH-A');
    expect(selectNearestWarehouse(LUDHIANA, [...tied].reverse())?.warehouse.code).toBe('WH-A');
  });
});

describe('RFP status machine', () => {
  it('allows the normal forward path', () => {
    expect(canTransition('Pending', 'Extracting')).toBe(true);
    expect(canTransition('Extracting', 'Parsing')).toBe(true);
    expect(canTransition('Parsing', 'Processing')).toBe(true);
    expect(canTransition('Processing', 'Complete')).toBe(true);
  });

  it('allows any stage to fail', () => {
    for (const status of ['Pending', 'Extracting', 'Parsing', 'Processing'] as AnalysisStatus[]) {
      expect(canTransition(status, 'Error')).toBe(true);
    }
  });

  it('refuses to move a completed analysis backwards', () => {
    // A late callback from an abandoned run must not reopen a finished one.
    for (const status of ANALYSIS_STATUSES) {
      if (status === 'Complete') continue;
      expect(canTransition('Complete', status)).toBe(false);
    }
  });

  it('refuses to skip stages', () => {
    expect(canTransition('Pending', 'Complete')).toBe(false);
    expect(canTransition('Extracting', 'Complete')).toBe(false);
  });

  it('allows a failed run to be retried from the beginning', () => {
    expect(canTransition('Error', 'Pending')).toBe(true);
    expect(canTransition('Error', 'Parsing')).toBe(true);
    expect(canTransition('Error', 'Complete')).toBe(false);
  });

  it('treats a repeated status as a no-op rather than an error', () => {
    for (const status of ANALYSIS_STATUSES) {
      expect(canTransition(status, status)).toBe(true);
    }
  });
});
