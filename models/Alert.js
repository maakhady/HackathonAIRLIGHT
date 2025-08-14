// models/Alert.js - Correction des index dupliqués
const mongoose = require('mongoose');

const AlertSchema = new mongoose.Schema({
  sensorId: { 
    type: String, 
    required: true,
    index: true 
  },
  alertType: { 
    type: String, 
    required: true,
    enum: [
      'air_quality_good',
      'air_quality_moderate', 
      'air_quality_poor',
      'air_quality_unhealthy',
      'air_quality_hazardous',
      'pollution_spike', 
      'prediction_warning', 
      'sensor_offline', 
      'co2_high',
      'multi_pollutant',
      'maintenance_required',
      'ai_service_down'
    ]
  },
  severity: { 
    type: String, 
    required: true,
    enum: ['good', 'moderate', 'poor', 'unhealthy', 'hazardous']
  },
  qualityLevel: {
    type: String,
    enum: ['excellent', 'good', 'moderate', 'poor', 'very_poor', 'extremely_poor']
  },
  referenceStandard: {
    type: String,
    enum: ['WHO_2021', 'EPA_2024', 'EU_2024'],
    default: 'WHO_2021'
  },
  message: { 
    type: String, 
    required: true,
    maxlength: 500 
  },
  data: {
    pollutants: {
      pm25: {
        value: Number,
        unit: { type: String, default: 'µg/m³' },
        threshold: Number,
        standard: String
      },
      pm10: {
        value: Number,
        unit: { type: String, default: 'µg/m³' },
        threshold: Number,
        standard: String
      },
      co2: {
        value: Number,
        unit: { type: String, default: 'ppm' },
        threshold: Number,
        standard: String
      }
    },
    
    healthInfo: {
      impact: String,
      recommendations: [String],
      sensitiveGroups: [String],
      symptoms: [String],
      protectionMeasures: [String]
    },
    
    environmentalContext: {
      harmattan: { type: Boolean, default: false },
      dustStorm: { type: Boolean, default: false },
      urbanPollution: { type: Boolean, default: false },
      trafficPeak: { type: Boolean, default: false },
      season: { 
        type: String, 
        enum: ['dry_season', 'wet_season', 'harmattan'], // 🔧 CORRECTION: wet_season au lieu de rainy_season
        default: 'dry_season'
      }
    },
    
    aqiValues: {
      who: Number,
      epa: Number,
      eu: Number,
      current: Number
    },
    
    // Anciens champs conservés pour compatibilité
    currentValue: Number,
    threshold: Number,
    location: String,
    elevatedParameters: [String],
    pm25Value: Number,
    pm10Value: Number,
    co2Value: Number,
    healthImpact: String,
    predictedValue: Number,
    predictedAQI: Number,
    confidence: Number,
    predictionFor: Date,
    hoursAhead: Number,
    parameter: String,
    error: String,
    fallbackMode: Boolean,
    lastCheck: Date,
    offlineDuration: String
  },
  
  // 🔧 CORRECTION: Retirer index: true pour éviter duplication
  location: {
    type: {
      type: String,
      enum: ['Point'],
      default: 'Point'
    },
    coordinates: [Number], // Index créé séparément plus bas
    address: String,
    district: String,
    city: { type: String, default: 'Dakar' }
  },
  
  tags: [String],
  
  // 🔧 CORRECTION: Retirer index: true pour éviter duplication
  expiresAt: {
    type: Date,
    default: function() {
      const hoursToAdd = {
        'good': 24,
        'moderate': 12,
        'poor': 6,
        'unhealthy': 2,
        'hazardous': 1
      };
      const hours = hoursToAdd[this.severity] || 6;
      return new Date(Date.now() + hours * 60 * 60 * 1000);
    }
    // Index TTL créé séparément plus bas
  },
  
  isActive: { 
    type: Boolean, 
    default: true, 
    index: true 
  },
  acknowledgedBy: String,
  acknowledgedAt: Date,
  resolvedBy: String,
  resolvedAt: Date,
  resolution: String,
  notificationsSent: [{
    type: { type: String, enum: ['email', 'sms', 'push', 'physical'] },
    sentAt: { type: Date, default: Date.now }
  }],
  createdBy: String,
  createdAt: { 
    type: Date, 
    default: Date.now, 
    index: true 
  }
});

// 🔧 CORRECTION: Index créés séparément pour éviter duplication
// Index composés
AlertSchema.index({ sensorId: 1, isActive: 1, severity: 1 });
AlertSchema.index({ isActive: 1, createdAt: -1 });
AlertSchema.index({ alertType: 1, isActive: 1 });
AlertSchema.index({ severity: 1, createdAt: -1 });
AlertSchema.index({ qualityLevel: 1, isActive: 1 });

// Index géospatial (créé UNE SEULE FOIS)
AlertSchema.index({ 'location.coordinates': '2dsphere' });

// Index TTL pour expiration automatique (créé UNE SEULE FOIS)
AlertSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Index pour recherche textuelle
AlertSchema.index({ 
  message: 'text',
  'data.healthInfo.impact': 'text',
  tags: 'text'
});

// Index pour filtrage par capteur et période
AlertSchema.index({ sensorId: 1, createdAt: -1 });

// Index pour stats par région
AlertSchema.index({ 'location.city': 1, 'location.district': 1, createdAt: -1 });

// 🆕 Méthodes du schéma
AlertSchema.methods.getHealthLevel = function() {
  const levels = ['good', 'moderate', 'poor', 'unhealthy', 'hazardous'];
  return levels.indexOf(this.severity);
};

AlertSchema.methods.isHealthCritical = function() {
  return ['unhealthy', 'hazardous'].includes(this.severity);
};

AlertSchema.methods.getRecommendations = function() {
  return this.data?.healthInfo?.recommendations || [];
};

AlertSchema.methods.getSensitiveGroups = function() {
  return this.data?.healthInfo?.sensitiveGroups || [];
};

// 🆕 Méthodes statiques pour recherche
AlertSchema.statics.findByHealthLevel = function(level, limit = 50) {
  return this.find({ 
    severity: level, 
    isActive: true 
  })
  .sort({ createdAt: -1 })
  .limit(limit);
};

AlertSchema.statics.findCriticalAlerts = function(hours = 24) {
  const startTime = new Date(Date.now() - hours * 60 * 60 * 1000);
  return this.find({
    severity: { $in: ['unhealthy', 'hazardous'] },
    isActive: true,
    createdAt: { $gte: startTime }
  }).sort({ createdAt: -1 });
};

AlertSchema.statics.getHealthStats = function(sensorId, days = 7) {
  const startTime = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  
  return this.aggregate([
    {
      $match: {
        ...(sensorId && { sensorId }),
        createdAt: { $gte: startTime }
      }
    },
    {
      $group: {
        _id: '$severity',
        count: { $sum: 1 },
        avgAQI: { $avg: '$data.aqiValues.current' }
      }
    },
    {
      $sort: { count: -1 }
    }
  ]);
};

// Middleware pre-save pour validation
AlertSchema.pre('save', function(next) {
  // Validation des seuils santé
  if (this.data?.pollutants?.pm25?.value) {
    const pm25 = this.data.pollutants.pm25.value;
    
    // Vérifier cohérence niveau/valeur
    if (this.severity === 'good' && pm25 > 15) {
      return next(new Error('Valeur PM2.5 incohérente avec niveau "good"'));
    }
    if (this.severity === 'hazardous' && pm25 < 55) {
      return next(new Error('Valeur PM2.5 incohérente avec niveau "hazardous"'));
    }
  }
  
  // Auto-définir qualityLevel si manquant
  if (!this.qualityLevel) {
    const qualityMap = {
      'good': 'excellent',
      'moderate': 'good', 
      'poor': 'poor',
      'unhealthy': 'very_poor',
      'hazardous': 'extremely_poor'
    };
    this.qualityLevel = qualityMap[this.severity] || 'moderate';
  }
  
  next();
});

// Middleware post-save pour notifications
AlertSchema.post('save', function(doc) {
  if (doc.isHealthCritical()) {
    console.log(`🚨 Alerte santé critique créée: ${doc.severity} - ${doc.message}`);
    // Ici vous pourriez déclencher des notifications push, SMS, etc.
  }
});

module.exports = mongoose.model('Alert', AlertSchema);