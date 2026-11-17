const { calculateHaversineDistanceKm } = require('../src/utils/geo');

describe('Haversine Distance Calculation', () => {
  it('should return 0 km for identical coordinates', () => {
    const dist = calculateHaversineDistanceKm(40.7128, -74.006, 40.7128, -74.006);
    expect(dist).toBe(0);
  });

  it('should calculate accurate distance between New York and London (~5,570 km)', () => {
    // New York: 40.7128, -74.0060; London: 51.5074, -0.1278
    const dist = calculateHaversineDistanceKm(40.7128, -74.006, 51.5074, -0.1278);
    expect(dist).toBeGreaterThan(5500);
    expect(dist).toBeLessThan(5600);
  });

  it('should calculate accurate distance between New York and Tokyo (~10,850 km)', () => {
    // New York: 40.7128, -74.0060; Tokyo: 35.6762, 139.6503
    const dist = calculateHaversineDistanceKm(40.7128, -74.006, 35.6762, 139.6503);
    expect(dist).toBeGreaterThan(10800);
    expect(dist).toBeLessThan(10900);
  });
});
