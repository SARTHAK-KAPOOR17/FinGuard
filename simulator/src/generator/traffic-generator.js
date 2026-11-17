const { PRNG } = require('./prng');

const CITIES = [
  { city: 'New York', country: 'USA', lat: 40.7128, lng: -74.0060 },
  { city: 'London', country: 'UK', lat: 51.5074, lng: -0.1278 },
  { city: 'Tokyo', country: 'Japan', lat: 35.6762, lng: 139.6503 },
  { city: 'Sydney', country: 'Australia', lat: -33.8688, lng: 151.2093 },
  { city: 'Paris', country: 'France', lat: 48.8566, lng: 2.3522 },
  { city: 'Singapore', country: 'Singapore', lat: 1.3521, lng: 103.8198 },
  { city: 'Toronto', country: 'Canada', lat: 43.6532, lng: -79.3832 },
  { city: 'Berlin', country: 'Germany', lat: 52.5200, lng: 13.4050 },
  { city: 'Mumbai', country: 'India', lat: 19.0760, lng: 72.8777 },
  { city: 'San Francisco', country: 'USA', lat: 37.7749, lng: -122.4194 },
];

const NORMAL_MERCHANTS = [
  'Amazon', 'Walmart', 'Target', 'Starbucks', 'Uber',
  'Netflix', 'Whole Foods', 'Apple Store', 'Shell', 'Best Buy',
  'Costco', 'McDonalds', 'Steam Games', 'Spotify', 'Nike Store'
];

const LUXURY_MERCHANTS = [
  'Rolex Boutique', 'Private Jet Charter', 'Diamond Exchange',
  'Offshore Crypto OTC', 'Luxury Motors Geneva', 'High Stakes Casino VIP'
];

const CURRENCIES = ['USD', 'EUR', 'GBP', 'INR', 'CAD', 'AUD', 'SGD'];

class TrafficGenerator {
  /**
   * @param {object} [options]
   * @param {number|string} [options.seed]
   * @param {number} [options.fraudRatio=0.05]
   * @param {number} [options.userPoolSize=5000]
   */
  constructor(options = {}) {
    this.prng = new PRNG(options.seed);
    this.fraudRatio = options.fraudRatio !== undefined ? options.fraudRatio : 0.05;
    this.userPoolSize = options.userPoolSize || 5000;

    // Pre-generate static user profiles for consistency
    this.users = [];
    for (let i = 1; i <= this.userPoolSize; i++) {
      const homeCity = this.prng.pick(CITIES);
      this.users.push({
        userId: `usr_${String(i).padStart(4, '0')}`,
        primaryDeviceId: `dev_${this.prng.nextUUID().slice(0, 12)}`,
        homeCity,
        currency: homeCity.country === 'USA' ? 'USD' : (homeCity.country === 'UK' ? 'GBP' : 'USD'),
      });
    }

    // Buffer for multi-transaction fraud bursts (rapid velocity or location jumps)
    this.pendingQueue = [];
  }

  /**
   * Generates a single normal transaction for a user.
   */
  _generateNormalTxn(user = null, timestamp = null) {
    const u = user || this.prng.pick(this.users);
    const amount = parseFloat((this.prng.nextFloat() * 250 + 2.5).toFixed(2));
    const merchant = this.prng.pick(NORMAL_MERCHANTS);
    const city = u.homeCity;
    const ts = timestamp || new Date().toISOString();

    return {
      txnId: this.prng.nextUUID(),
      userId: u.userId,
      amount,
      currency: u.currency,
      merchant,
      location: {
        city: city.city,
        country: city.country,
        lat: parseFloat((city.lat + (this.prng.nextFloat() - 0.5) * 0.05).toFixed(4)),
        lng: parseFloat((city.lng + (this.prng.nextFloat() - 0.5) * 0.05).toFixed(4)),
      },
      deviceId: u.primaryDeviceId,
      timestamp: ts,
    };
  }

  /**
   * Generates a fraud pattern:
   * 1. large_amount
   * 2. rapid_velocity (queued burst)
   * 3. location_jump (queued sequential jump)
   */
  _generateFraudPattern() {
    const patternType = this.prng.pick(['large_amount', 'rapid_velocity', 'location_jump']);
    const user = this.prng.pick(this.users);

    if (patternType === 'large_amount') {
      const amount = parseFloat((this.prng.nextFloat() * 75000 + 10000).toFixed(2));
      const merchant = this.prng.pick(LUXURY_MERCHANTS);
      const txn = {
        ...this._generateNormalTxn(user),
        amount,
        merchant,
      };
      return [{ txn, pattern: 'large_amount' }];
    }

    if (patternType === 'rapid_velocity') {
      // 5 to 7 transactions in rapid succession for the same user
      const burstSize = this.prng.nextInt(5, 7);
      const results = [];
      const baseTime = Date.now();

      for (let i = 0; i < burstSize; i++) {
        const timeOffset = i * 20; // 20ms apart
        const ts = new Date(baseTime + timeOffset).toISOString();
        const txn = this._generateNormalTxn(user, ts);
        results.push({ txn, pattern: 'rapid_velocity' });
      }
      return results;
    }

    if (patternType === 'location_jump') {
      // Impossible travel: Transaction 1 in Home City, Transaction 2 in distant continent 1-2 seconds later
      const distantCities = CITIES.filter((c) => c.city !== user.homeCity.city);
      const distantCity = this.prng.pick(distantCities);

      const baseTime = Date.now();
      const txn1 = this._generateNormalTxn(user, new Date(baseTime).toISOString());

      const txn2 = {
        ...this._generateNormalTxn(user, new Date(baseTime + 1500).toISOString()),
        location: {
          city: distantCity.city,
          country: distantCity.country,
          lat: distantCity.lat,
          lng: distantCity.lng,
        },
      };

      return [
        { txn: txn1, pattern: 'location_jump' },
        { txn: txn2, pattern: 'location_jump' },
      ];
    }

    // Fallback
    return [{ txn: this._generateNormalTxn(user), pattern: 'normal' }];
  }

  /**
   * Returns the next transaction and its classification.
   *
   * @returns {{ txn: object, pattern: string }}
   */
  nextTransaction() {
    // If we have pending transactions from a multi-item pattern, flush from queue
    if (this.pendingQueue.length > 0) {
      return this.pendingQueue.shift();
    }

    // Decide if this step initiates a fraud pattern
    const isFraud = this.prng.nextFloat() < this.fraudRatio;

    if (isFraud) {
      const generated = this._generateFraudPattern();
      const first = generated[0];
      for (let i = 1; i < generated.length; i++) {
        this.pendingQueue.push(generated[i]);
      }
      return first;
    }

    return {
      txn: this._generateNormalTxn(),
      pattern: 'normal',
    };
  }
}

module.exports = {
  TrafficGenerator,
  CITIES,
  NORMAL_MERCHANTS,
  LUXURY_MERCHANTS,
};
