const EARTH_RADIUS_KM = 6371.0088;

export function distanceKm(
  latitudeA: number,
  longitudeA: number,
  latitudeB: number,
  longitudeB: number,
): number {
  const φ1 = (latitudeA * Math.PI) / 180;
  const φ2 = (latitudeB * Math.PI) / 180;
  const Δφ = ((latitudeB - latitudeA) * Math.PI) / 180;
  const Δλ = ((longitudeB - longitudeA) * Math.PI) / 180;
  const h =
    Math.sin(Δφ / 2) ** 2 +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function destinationNorthKm(
  latitude: number,
  longitude: number,
  kilometers: number,
): { latitude: number; longitude: number } {
  const φ2 = (latitude * Math.PI) / 180 + kilometers / EARTH_RADIUS_KM;
  return { latitude: (φ2 * 180) / Math.PI, longitude };
}

export function roundKm(kilometers: number): number {
  return Math.round(kilometers * 10) / 10;
}

export function formatKm(kilometers: number): string {
  return `${roundKm(kilometers).toFixed(1)} km`;
}
