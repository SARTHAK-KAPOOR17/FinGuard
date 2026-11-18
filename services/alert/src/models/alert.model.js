const mongoose = require('mongoose');
const crypto = require('crypto');

const SEVERITY_ENUM = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
const STATUS_ENUM = ['OPEN', 'INVESTIGATING', 'RESOLVED', 'DISMISSED'];

const SEVERITY_RANKS = Object.freeze({
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  CRITICAL: 4,
});

/**
 * Computes highest severity from an array of matched rules.
 * Priority order: CRITICAL > HIGH > MEDIUM > LOW
 */
function getHighestSeverity(matchedRules = []) {
  if (!Array.isArray(matchedRules) || matchedRules.length === 0) {
    return 'LOW';
  }

  let highest = 'LOW';
  for (const rule of matchedRules) {
    const ruleSeverity = rule?.severity?.toUpperCase();
    if (
      SEVERITY_RANKS[ruleSeverity] &&
      SEVERITY_RANKS[ruleSeverity] > SEVERITY_RANKS[highest]
    ) {
      highest = ruleSeverity;
    }
  }

  return highest;
}

const MatchedRuleSubSchema = new mongoose.Schema(
  {
    ruleId: { type: String, required: true },
    ruleName: { type: String, required: true },
    severity: { type: String, enum: SEVERITY_ENUM, required: true },
    reason: { type: String, required: true },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { _id: false }
);

const LocationSubSchema = new mongoose.Schema(
  {
    city: { type: String, default: null },
    country: { type: String, default: null },
    lat: { type: Number, default: null },
    lng: { type: Number, default: null },
  },
  { _id: false }
);

const NoteSubSchema = new mongoose.Schema(
  {
    author: { type: String, required: true },
    text: { type: String, required: true },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const AlertSchema = new mongoose.Schema(
  {
    alertId: {
      type: String,
      default: () => crypto.randomUUID(),
      required: true,
      index: true,
    },
    txnId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    flaggedId: {
      type: String,
      required: true,
    },
    userId: {
      type: String,
      required: true,
      index: true,
    },
    amount: {
      type: Number,
      required: true,
    },
    currency: {
      type: String,
      required: true,
      uppercase: true,
      minlength: 3,
      maxlength: 3,
    },
    merchant: {
      type: String,
      required: true,
    },
    location: {
      type: LocationSubSchema,
      default: () => ({}),
    },
    deviceId: {
      type: String,
      required: true,
    },
    timestamp: {
      type: Date,
      required: true,
    },
    flaggedAt: {
      type: Date,
      required: true,
      default: Date.now,
    },
    matchedRules: {
      type: [MatchedRuleSubSchema],
      required: true,
      validate: [
        (rules) => Array.isArray(rules) && rules.length > 0,
        'Alert must have at least one matched rule',
      ],
    },
    riskScore: {
      type: Number,
      required: true,
      min: 0,
      max: 100,
    },
    severity: {
      type: String,
      enum: SEVERITY_ENUM,
      required: true,
    },
    status: {
      type: String,
      enum: STATUS_ENUM,
      default: 'OPEN',
      required: true,
      index: true,
    },
    assignedTo: {
      type: String,
      default: null,
    },
    notes: {
      type: [NoteSubSchema],
      default: [],
    },
  },
  {
    timestamps: true,
    collection: 'alerts',
  }
);

// Compound and query indexes
AlertSchema.index({ severity: 1, createdAt: -1 });
AlertSchema.index({ status: 1, createdAt: -1 });
AlertSchema.index({ userId: 1, createdAt: -1 });
AlertSchema.index({ riskScore: -1, createdAt: -1 });
AlertSchema.index({ 'matchedRules.ruleId': 1, createdAt: -1 });
AlertSchema.index({ createdAt: -1 });

const Alert = mongoose.model('Alert', AlertSchema);

module.exports = {
  Alert,
  SEVERITY_ENUM,
  STATUS_ENUM,
  SEVERITY_RANKS,
  getHighestSeverity,
};
