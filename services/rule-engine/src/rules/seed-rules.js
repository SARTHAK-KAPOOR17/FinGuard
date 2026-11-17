/**
 * Default Seed Rules for MongoDB Collection `rules`
 */
const SEED_RULES = [
  {
    ruleId: 'RULE_LARGE_AMOUNT',
    name: 'High Transaction Amount',
    description: 'Flags transactions with amount strictly greater than threshold in USD',
    type: 'THRESHOLD',
    severity: 'HIGH',
    enabled: true,
    config: {
      threshold: 10000,
      currency: 'USD',
    },
  },
  {
    ruleId: 'RULE_SUSPICIOUS_MERCHANT',
    name: 'Suspicious High-Risk Merchant Match',
    description: 'Flags transactions conducted at luxury, offshore, or high-risk merchants matching suspicious keywords',
    type: 'REGEX',
    severity: 'CRITICAL',
    enabled: true,
    config: {
      pattern: '(Rolex Boutique|Private Jet Charter|Diamond Exchange|Offshore Crypto OTC|Luxury Motors Geneva|High Stakes Casino VIP)',
    },
  },
  {
    ruleId: 'RULE_VELOCITY',
    name: 'High Frequency Velocity Check',
    description: 'Flags users making more than N transactions within a sliding time window',
    type: 'VELOCITY',
    severity: 'HIGH',
    enabled: true,
    config: {
      windowSeconds: 10,
      maxAllowed: 5,
    },
  },
  {
    ruleId: 'RULE_LOCATION_JUMP',
    name: 'Impossible Travel & Geo Distance Jump',
    description: 'Flags sudden geographical jumps between distant countries exceeding commercial airliner speeds',
    type: 'GEO_DISTANCE',
    severity: 'CRITICAL',
    enabled: true,
    config: {
      maxSpeedKmh: 900,
      minDistanceKm: 100,
      countryChangeMinSeconds: 300,
    },
  },
];

module.exports = {
  SEED_RULES,
};
