// models/Alert.js - Version complète avec support météo
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
      'ai_service_down',
      'weather_air_quality',    // ✅ NOUVEAU
      'weather_alert',           // ✅ NOUVEAU
      'harmattan_warning',       // ✅ NOUVEAU
      'wind_dispersion'          // ✅ NOUVEAU
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
    enum: [
      'WHO_2021', 
      'EPA_2024', 
      'EU_2024',
      'METEOROLOGICAL',          // ✅ NOUVEAU
      'PREDICTED',               // ✅ NOUVEAU
      'SENSOR_HEALTH'            // ✅ NOUVEAU
    ],
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
        enum: ['dry_season', 'wet_season', 'harmattan'],
        default: 'dry_season'
      }
    },
    
    // ✅ NOUVEAU: Données météorologiques
    weatherData: {
      temperature: Number,
      humidity: Number,
      pressure: Number,
      windSpeed: Number,
      windDirection: Number,
      weatherCondition: String,
      weatherDescription: String,
      visibility: Number,
      cloudCover: Number,
      uvIndex: Number,
      airDispersionIndex: Number,
      particulateSuspension: Number,
      pollutantAccumulation: Number
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
  
  location: {
    type: {
      type: String,
      enum: ['Point'],
      default: 'Point'
    },
    coordinates: [Number],
    address: String,
    district: String,
    city: { type: String, default: 'Dakar' }
  },
  
  tags: [String],
  
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

// Index composés
AlertSchema.index({ sensorId: 1, isActive: 1, severity: 1 });
AlertSchema.index({ isActive: 1, createdAt: -1 });
AlertSchema.index({ alertType: 1, isActive: 1 });
AlertSchema.index({ severity: 1, createdAt: -1 });
AlertSchema.index({ qualityLevel: 1, isActive: 1 });
AlertSchema.index({ 'location.coordinates': '2dsphere' });
AlertSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// ✅ NOUVEAUX index pour météo
AlertSchema.index({ 
  alertType: 1, 
  'data.weatherData.windSpeed': 1, 
  isActive: 1 
});
AlertSchema.index({ 
  'data.environmentalContext.harmattan': 1, 
  isActive: 1 
});

// Index pour recherche textuelle
AlertSchema.index({ 
  message: 'text',
  'data.healthInfo.impact': 'text',
  tags: 'text'
});

AlertSchema.index({ sensorId: 1, createdAt: -1 });
AlertSchema.index({ 'location.city': 1, 'location.district': 1, createdAt: -1 });

// Méthodes du schéma
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

// ✅ NOUVELLES méthodes pour météo
AlertSchema.methods.isWeatherAlert = function() {
  return [
    'weather_air_quality', 
    'weather_alert', 
    'harmattan_warning', 
    'wind_dispersion'
  ].includes(this.alertType);
};

AlertSchema.methods.getWeatherImpact = function() {
  if (!this.data?.weatherData) return null;
  
  const weather = this.data.weatherData;
  return {
    dispersion: weather.airDispersionIndex || 0,
    suspension: weather.particulateSuspension || 0,
    accumulation: weather.pollutantAccumulation || 0,
    overallImpact: this.calculateOverallWeatherImpact()
  };
};

AlertSchema.methods.calculateOverallWeatherImpact = function() {
  const weather = this.data?.weatherData;
  if (!weather) return 0;
  
  let impact = 0;
  
  if (weather.windSpeed < 5) impact += 30;
  else if (weather.windSpeed < 10) impact += 15;
  
  if (weather.humidity > 80) impact += 20;
  else if (weather.humidity > 60) impact += 10;
  
  if (weather.pressure < 1010) impact += 20;
  else if (weather.pressure < 1013) impact += 10;
  
  if (weather.temperature > 30 && weather.humidity > 60) impact += 20;
  
  return Math.min(impact, 100);
};

// Méthodes statiques
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

// ✅ NOUVELLE méthode statique pour alertes météo
AlertSchema.statics.findActiveWeatherAlerts = function(hours = 24) {
  const startTime = new Date(Date.now() - hours * 60 * 60 * 1000);
  return this.find({
    alertType: { 
      $in: ['weather_air_quality', 'weather_alert', 'harmattan_warning', 'wind_dispersion'] 
    },
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

// Middleware pre-save
AlertSchema.pre('save', function(next) {
  if (this.data?.pollutants?.pm25?.value) {
    const pm25 = this.data.pollutants.pm25.value;
    
    if (this.severity === 'good' && pm25 > 15) {
      return next(new Error('Valeur PM2.5 incohérente avec niveau "good"'));
    }
    if (this.severity === 'hazardous' && pm25 < 55) {
      return next(new Error('Valeur PM2.5 incohérente avec niveau "hazardous"'));
    }
  }
  
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

// Middleware post-save
AlertSchema.post('save', function(doc) {
  if (doc.isHealthCritical()) {
    console.log(`🚨 Alerte santé critique créée: ${doc.severity} - ${doc.message}`);
  }
  
  // ✅ NOUVEAU: Log pour alertes météo
  if (doc.isWeatherAlert()) {
    console.log(`🌤️ Alerte météo créée: ${doc.alertType} - ${doc.message}`);
  }
});

module.exports = mongoose.model('Alert', AlertSchema);