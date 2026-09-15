/**
 * Geospatial helpers for freight estimation.
 *
 * Pure functions, no I/O, no clock — the same inputs always produce the same
 * distance, which is what lets the logistics component of a discovery score
 * be reproduced and audited.
 */

export interface Coordinates {
  latitude: number;
  longitude: number;
}

const EARTH_RADIUS_KM = 6371;

/**
 * Road distance is longer than the great-circle line. Applying a flat factor
 * is crude, but it is explicit, deterministic, and closer to reality than
 * quoting the straight-line distance as if a truck could drive it.
 */
export const ROAD_DISTANCE_FACTOR = 1.25;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

export function isUsableCoordinate(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value !== 0;
}

/** Great-circle distance in kilometres, rounded to one decimal place. */
export function haversineKm(from: Coordinates, to: Coordinates): number {
  const dLat = toRadians(to.latitude - from.latitude);
  const dLon = toRadians(to.longitude - from.longitude);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(from.latitude)) * Math.cos(toRadians(to.latitude)) * Math.sin(dLon / 2) ** 2;

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(EARTH_RADIUS_KM * c * 10) / 10;
}

/** Haversine distance adjusted by the road factor. */
export function roadDistanceKm(from: Coordinates, to: Coordinates): number {
  return Math.round(haversineKm(from, to) * ROAD_DISTANCE_FACTOR * 10) / 10;
}

/**
 * Coordinates for Indian states, union territories and major cities.
 *
 * A bundled gazetteer rather than a geocoding API call: tender consignee
 * fields name a city or a state, resolution must be deterministic for
 * scoring to be reproducible, and an unrecognised place must return null
 * rather than a plausible-looking guess.
 */
const GAZETTEER: Record<string, Coordinates> = {
  // States and union territories
  'andhra pradesh': { latitude: 15.9129, longitude: 79.74 },
  'arunachal pradesh': { latitude: 28.218, longitude: 94.7278 },
  assam: { latitude: 26.2006, longitude: 92.9376 },
  bihar: { latitude: 25.0961, longitude: 85.3131 },
  chhattisgarh: { latitude: 21.2787, longitude: 81.8661 },
  goa: { latitude: 15.2993, longitude: 74.124 },
  gujarat: { latitude: 22.2587, longitude: 71.1924 },
  haryana: { latitude: 29.0588, longitude: 76.0856 },
  'himachal pradesh': { latitude: 31.1048, longitude: 77.1734 },
  jharkhand: { latitude: 23.6102, longitude: 85.2799 },
  karnataka: { latitude: 15.3173, longitude: 75.7139 },
  kerala: { latitude: 10.8505, longitude: 76.2711 },
  'madhya pradesh': { latitude: 22.9734, longitude: 78.6569 },
  maharashtra: { latitude: 19.7515, longitude: 75.7139 },
  manipur: { latitude: 24.6637, longitude: 93.9063 },
  meghalaya: { latitude: 25.467, longitude: 91.3662 },
  mizoram: { latitude: 23.1645, longitude: 92.9376 },
  nagaland: { latitude: 26.1584, longitude: 94.5624 },
  odisha: { latitude: 20.9517, longitude: 85.0985 },
  punjab: { latitude: 31.1471, longitude: 75.3412 },
  rajasthan: { latitude: 27.0238, longitude: 74.2179 },
  sikkim: { latitude: 27.533, longitude: 88.5122 },
  'tamil nadu': { latitude: 11.1271, longitude: 78.6569 },
  telangana: { latitude: 18.1124, longitude: 79.0193 },
  tripura: { latitude: 23.9408, longitude: 91.9882 },
  'uttar pradesh': { latitude: 26.8467, longitude: 80.9462 },
  uttarakhand: { latitude: 30.0668, longitude: 79.0193 },
  'west bengal': { latitude: 22.9868, longitude: 87.855 },
  delhi: { latitude: 28.7041, longitude: 77.1025 },
  'new delhi': { latitude: 28.6139, longitude: 77.209 },
  'jammu and kashmir': { latitude: 33.7782, longitude: 76.5762 },
  ladakh: { latitude: 34.2996, longitude: 78.2932 },
  puducherry: { latitude: 11.9416, longitude: 79.8083 },
  chandigarh: { latitude: 30.7333, longitude: 76.7794 },
  'andaman and nicobar islands': { latitude: 11.7401, longitude: 92.6586 },

  // Major cities and industrial centres
  mumbai: { latitude: 19.076, longitude: 72.8777 },
  pune: { latitude: 18.5204, longitude: 73.8567 },
  nagpur: { latitude: 21.1458, longitude: 79.0882 },
  bengaluru: { latitude: 12.9716, longitude: 77.5946 },
  bangalore: { latitude: 12.9716, longitude: 77.5946 },
  chennai: { latitude: 13.0827, longitude: 80.2707 },
  coimbatore: { latitude: 11.0168, longitude: 76.9558 },
  hyderabad: { latitude: 17.385, longitude: 78.4867 },
  kolkata: { latitude: 22.5726, longitude: 88.3639 },
  ahmedabad: { latitude: 23.0225, longitude: 72.5714 },
  surat: { latitude: 21.1702, longitude: 72.8311 },
  vadodara: { latitude: 22.3072, longitude: 73.1812 },
  jaipur: { latitude: 26.9124, longitude: 75.7873 },
  lucknow: { latitude: 26.8467, longitude: 80.9462 },
  kanpur: { latitude: 26.4499, longitude: 80.3319 },
  patna: { latitude: 25.5941, longitude: 85.1376 },
  bhopal: { latitude: 23.2599, longitude: 77.4126 },
  indore: { latitude: 22.7196, longitude: 75.8577 },
  ludhiana: { latitude: 30.901, longitude: 75.8573 },
  jalandhar: { latitude: 31.326, longitude: 75.5762 },
  amritsar: { latitude: 31.634, longitude: 74.8723 },
  gurugram: { latitude: 28.4595, longitude: 77.0266 },
  gurgaon: { latitude: 28.4595, longitude: 77.0266 },
  noida: { latitude: 28.5355, longitude: 77.391 },
  faridabad: { latitude: 28.4089, longitude: 77.3178 },
  ghaziabad: { latitude: 28.6692, longitude: 77.4538 },
  visakhapatnam: { latitude: 17.6868, longitude: 83.2185 },
  vijayawada: { latitude: 16.5062, longitude: 80.648 },
  kochi: { latitude: 9.9312, longitude: 76.2673 },
  thiruvananthapuram: { latitude: 8.5241, longitude: 76.9366 },
  bhubaneswar: { latitude: 20.2961, longitude: 85.8245 },
  raipur: { latitude: 21.2514, longitude: 81.6296 },
  ranchi: { latitude: 23.3441, longitude: 85.3096 },
  jamshedpur: { latitude: 22.8046, longitude: 86.2029 },
  guwahati: { latitude: 26.1445, longitude: 91.7362 },
  dehradun: { latitude: 30.3165, longitude: 78.0322 },
  shimla: { latitude: 31.1048, longitude: 77.1734 },
  rourkela: { latitude: 22.2604, longitude: 84.8536 },
  durgapur: { latitude: 23.5204, longitude: 87.3119 },
  bhilai: { latitude: 21.1938, longitude: 81.3509 },
  mysuru: { latitude: 12.2958, longitude: 76.6394 },
  madurai: { latitude: 9.9252, longitude: 78.1198 },
  nashik: { latitude: 19.9975, longitude: 73.7898 },
  aurangabad: { latitude: 19.8762, longitude: 75.3433 },
  rajkot: { latitude: 22.3039, longitude: 70.8022 },
  jodhpur: { latitude: 26.2389, longitude: 73.0243 },
  varanasi: { latitude: 25.3176, longitude: 82.9739 },
  allahabad: { latitude: 25.4358, longitude: 81.8463 },
  prayagraj: { latitude: 25.4358, longitude: 81.8463 },
  siliguri: { latitude: 26.7271, longitude: 88.3953 },
  cuttack: { latitude: 20.4625, longitude: 85.8828 },
  salem: { latitude: 11.6643, longitude: 78.146 },
  trichy: { latitude: 10.7905, longitude: 78.7047 },
  tiruchirappalli: { latitude: 10.7905, longitude: 78.7047 },
  hubli: { latitude: 15.3647, longitude: 75.124 },
  belgaum: { latitude: 15.8497, longitude: 74.4977 },
  udaipur: { latitude: 24.5854, longitude: 73.7125 },
  gwalior: { latitude: 26.2183, longitude: 78.1828 },
  jabalpur: { latitude: 23.1815, longitude: 79.9864 },
  meerut: { latitude: 28.9845, longitude: 77.7064 },
  agra: { latitude: 27.1767, longitude: 78.0081 },
  panaji: { latitude: 15.4909, longitude: 73.8278 },
  haldia: { latitude: 22.0667, longitude: 88.0698 },
  paradip: { latitude: 20.3164, longitude: 86.6108 },
  kandla: { latitude: 23.0333, longitude: 70.2167 },
  tuticorin: { latitude: 8.7642, longitude: 78.1348 },
};

export interface ResolvedLocation {
  coordinates: Coordinates;
  /** The gazetteer key that matched, for explaining the result. */
  matchedOn: string;
  precision: 'city' | 'state';
}

const STATE_KEYS = new Set(
  Object.keys(GAZETTEER).filter(key =>
    [
      'andhra pradesh', 'arunachal pradesh', 'assam', 'bihar', 'chhattisgarh', 'goa', 'gujarat',
      'haryana', 'himachal pradesh', 'jharkhand', 'karnataka', 'kerala', 'madhya pradesh',
      'maharashtra', 'manipur', 'meghalaya', 'mizoram', 'nagaland', 'odisha', 'punjab',
      'rajasthan', 'sikkim', 'tamil nadu', 'telangana', 'tripura', 'uttar pradesh',
      'uttarakhand', 'west bengal', 'jammu and kashmir', 'ladakh',
      'andaman and nicobar islands',
    ].includes(key)
  )
);

/**
 * Resolves free-text consignee location to coordinates.
 *
 * Returns null when nothing matches. That null is the point: an unresolved
 * consignee must surface as "distance unknown", never as a default city that
 * happens to be near a warehouse.
 */
export function resolveLocation(text: string | null | undefined): ResolvedLocation | null {
  if (!text || typeof text !== 'string') return null;

  const normalized = text.toLowerCase().replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!normalized) return null;

  // A city is more specific than a state, so city keys win. Longer keys are
  // tried first so "new delhi" is not shadowed by "delhi".
  const candidates = Object.keys(GAZETTEER).sort((a, b) => b.length - a.length);

  let stateMatch: ResolvedLocation | null = null;

  for (const key of candidates) {
    // Word-boundary match: "goa" must not match inside "gangtok goalpara".
    const pattern = new RegExp(`(^|\\s)${key.replace(/\s+/g, '\\s+')}($|\\s)`);
    if (!pattern.test(normalized)) continue;

    const resolved: ResolvedLocation = {
      coordinates: GAZETTEER[key],
      matchedOn: key,
      precision: STATE_KEYS.has(key) ? 'state' : 'city',
    };

    if (resolved.precision === 'city') return resolved;
    if (!stateMatch) stateMatch = resolved;
  }

  return stateMatch;
}

export interface WarehouseCandidate {
  code: string;
  location: string;
  coordinates: Coordinates | null;
}

export interface WarehouseSelection {
  warehouse: WarehouseCandidate;
  distanceKm: number;
}

/**
 * Picks the nearest warehouse with usable coordinates.
 *
 * Ties break on warehouse code so repeated runs select the same one — a
 * discovery score that shifted between equidistant warehouses would not be
 * reproducible.
 */
export function selectNearestWarehouse(
  destination: Coordinates,
  warehouses: WarehouseCandidate[]
): WarehouseSelection | null {
  const measurable = warehouses.filter(w => w.coordinates !== null);
  if (measurable.length === 0) return null;

  const ranked = measurable
    .map(warehouse => ({
      warehouse,
      distanceKm: roadDistanceKm(warehouse.coordinates as Coordinates, destination),
    }))
    .sort((a, b) => a.distanceKm - b.distanceKm || a.warehouse.code.localeCompare(b.warehouse.code));

  return ranked[0];
}
