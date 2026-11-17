const { calculateHaversineDistanceKm } = require('../utils/geo');

const SEVERITY_BASE_SCORES = {
  LOW: 25,
  MEDIUM: 50,
  HIGH: 75,
  CRITICAL: 90,
};

const EXTRA_RULE_BONUS = 5;

class RuleEvaluator {
  /**
   * @param {Array<object>} rules - Array of Rule documents / objects from MongoDB
   */
  constructor(rules = []) {
    this.rules = rules.map((r) => {
      let normType = (r.type || '').toUpperCase();
      if (normType === 'AMOUNT_THRESHOLD') normType = 'THRESHOLD';
      if (normType === 'MERCHANT_REGEX') normType = 'REGEX';
      if (normType === 'GEO_JUMP') normType = 'GEO_DISTANCE';

      return {
        ruleId: r.ruleId,
        name: r.name,
        description: r.description,
        type: normType,
        originalType: r.type,
        severity: r.severity,
        enabled: r.enabled !== false,
        config: r.config || {},
      };
    });
  }

  /**
   * Evaluates a transaction against all enabled rules.
   *
   * @param {object} txn
   * @param {object} [context]
   * @param {object} [context.redis] - ioredis client for stateful sliding windows
   * @returns {Promise<{ isFlagged: boolean, matchedRules: Array<object>, riskScore: number }>}
   */
  async evaluate(txn, context = {}) {
    const matchedRules = [];
    let calculatedScore = 0;
    const redis = context.redis;

    for (const rule of this.rules) {
      if (!rule.enabled) continue;

      try {
        let matchResult = { matched: false };

        switch (rule.type) {
          case 'THRESHOLD': {
            const threshold = rule.config.threshold || 10000;
            const currency = rule.config.currency || 'USD';
            const operator = rule.config.operator || '>';
            const isAmountMatch = operator === '>=' ? txn.amount >= threshold : txn.amount > threshold;

            if (isAmountMatch && (!currency || txn.currency === currency)) {
              matchResult = {
                matched: true,
                reason: `Transaction amount of $${txn.amount.toFixed(2)} ${txn.currency} exceeds threshold of $${threshold.toLocaleString()} ${currency}`,
                metadata: {
                  amount: txn.amount,
                  threshold,
                  currency,
                  operator,
                },
              };
            }
            break;
          }

          case 'REGEX': {
            const patternStr = rule.config.pattern;
            if (patternStr) {
              const regex = new RegExp(patternStr, 'i');
              if (regex.test(txn.merchant)) {
                matchResult = {
                  matched: true,
                  reason: `Merchant "${txn.merchant}" matches suspicious merchant pattern`,
                  metadata: {
                    merchant: txn.merchant,
                    matchedPattern: patternStr,
                  },
                };
              }
            }
            break;
          }

          case 'VELOCITY': {
            if (redis) {
              const windowSeconds = rule.config.windowSeconds || 10;
              const maxAllowed = rule.config.maxAllowed || 5;
              const key = `velocity:${txn.userId}`;
              const nowMs = new Date(txn.timestamp).getTime() || Date.now();
              const windowMs = windowSeconds * 1000;
              const minScore = nowMs - windowMs;

              // Atomic pipeline: purge old, add current, count in window, set expiration
              const pipeline = redis.pipeline();
              pipeline.zremrangebyscore(key, 0, minScore);
              pipeline.zadd(key, nowMs, txn.txnId);
              pipeline.zcard(key);
              pipeline.expire(key, Math.max(60, windowSeconds * 4));

              const results = await pipeline.exec();
              // results[2] is zcard output: [null, count]
              const currentCount = results && results[2] ? results[2][1] : 1;

              if (currentCount > maxAllowed) {
                matchResult = {
                  matched: true,
                  reason: `Velocity limit exceeded: ${currentCount} transactions within ${windowSeconds}s (max allowed: ${maxAllowed})`,
                  metadata: {
                    windowSeconds,
                    maxAllowed,
                    currentCount,
                  },
                };
              }
            }
            break;
          }

          case 'GEO_DISTANCE': {
            if (redis && txn.location && typeof txn.location.lat === 'number') {
              const maxSpeedKmh = rule.config.maxSpeedKmh || 900;
              const minDistanceKm = rule.config.minDistanceKm || 100;
              const countryChangeMinSeconds = rule.config.countryChangeMinSeconds || 300;
              const key = `location:${txn.userId}`;
              const nowMs = new Date(txn.timestamp).getTime() || Date.now();

              const prevLocationRaw = await redis.get(key);

              // Update Redis to latest location immediately (TTL 24h)
              const currentLocationData = JSON.stringify({
                city: txn.location.city,
                country: txn.location.country,
                lat: txn.location.lat,
                lng: txn.location.lng,
                timestamp: txn.timestamp,
                nowMs,
              });
              await redis.set(key, currentLocationData, 'EX', 86400);

              if (prevLocationRaw) {
                try {
                  const prev = JSON.parse(prevLocationRaw);
                  const distanceKm = calculateHaversineDistanceKm(
                    prev.lat,
                    prev.lng,
                    txn.location.lat,
                    txn.location.lng
                  );

                  const elapsedMs = Math.max(50, nowMs - (prev.nowMs || new Date(prev.timestamp).getTime()));
                  const elapsedSeconds = elapsedMs / 1000;
                  const elapsedHours = elapsedMs / 3600000;
                  const impliedSpeedKmh = parseFloat((distanceKm / elapsedHours).toFixed(1));
                  const countryChanged = prev.country !== txn.location.country;

                  const isImpossibleSpeed = distanceKm >= minDistanceKm && impliedSpeedKmh > maxSpeedKmh;
                  const isRapidCountryChange =
                    countryChanged && distanceKm >= minDistanceKm && elapsedSeconds < countryChangeMinSeconds;

                  if (isImpossibleSpeed || isRapidCountryChange) {
                    matchResult = {
                      matched: true,
                      reason: `Impossible travel jump: ${distanceKm.toFixed(1)} km in ${elapsedSeconds.toFixed(1)}s (implied speed: ${impliedSpeedKmh.toFixed(0)} km/h, max: ${maxSpeedKmh} km/h)`,
                      metadata: {
                        distanceKm,
                        elapsedSeconds,
                        impliedSpeedKmh,
                        maxSpeedKmh,
                        from: { city: prev.city, country: prev.country },
                        to: { city: txn.location.city, country: txn.location.country },
                      },
                    };
                  }
                } catch {
                  // Fallback if previous location record was malformed
                }
              }
              // If no previous location, this is first transaction of user -> do not flag
            }
            break;
          }

          default:
            break;
        }

        if (matchResult && matchResult.matched) {
          matchedRules.push({
            ruleId: rule.ruleId,
            ruleName: rule.name,
            severity: rule.severity,
            reason: matchResult.reason || `${rule.name} triggered`,
            metadata: matchResult.metadata || {},
          });
        }
      } catch (err) {
        // Individual rule execution failure does not block evaluation of remaining rules
        continue;
      }
    }

    const isFlagged = matchedRules.length > 0;
    let riskScore = 0;
    if (isFlagged) {
      const maxBaseScore = Math.max(
        ...matchedRules.map((r) => SEVERITY_BASE_SCORES[r.severity] || 25)
      );
      const extraBonus = (matchedRules.length - 1) * EXTRA_RULE_BONUS;
      riskScore = Math.min(100, maxBaseScore + extraBonus);
    }

    return {
      isFlagged,
      matchedRules,
      riskScore,
    };
  }

  getRules() {
    return this.rules.map((r) => ({
      ruleId: r.ruleId,
      name: r.name,
      description: r.description,
      type: r.type,
      severity: r.severity,
      enabled: r.enabled,
      config: r.config,
    }));
  }

  setRuleEnabled(ruleId, enabled) {
    const rule = this.rules.find((r) => r.ruleId === ruleId);
    if (rule) {
      rule.enabled = Boolean(enabled);
      return true;
    }
    return false;
  }
}

module.exports = {
  RuleEvaluator,
};
