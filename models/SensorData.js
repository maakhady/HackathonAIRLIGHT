// models/SensorData.js - Modèle pour les données des capteurs (DÉFINITIF)
const mongoose = require('mongoose');

const SensorDataSchema = new mongoose.Schema({
  sensorId: { 
    type: String, 
    required: true, 
    index: true 
  },
  location: {
    name: String,
    latitude: Number,
    longitude: Number,
    city: String
  },
  measurements: {
    pm25: { type: Number, min: 0 },
    pm10: { type: Number, min: 0 },
    pm1: { type: Number, min: 0 },
    pm03: { type: Number, min: 0 },
    co2: { type: Number, min: 0 },
    tvoc: { type: Number, min: 0 }, // Ind40
    nox: { type: Number, min: 0 },  // Ind41
    temperature: Number,
    humidity: { type: Number, min: 0, max: 100 }
  },
  airQualityIndex: { 
    type: Number, 
    min: 0, 
    max: 500 
  },
  qualityLevel: { 
    type: String, 
    enum: ['good', 'moderate', 'poor', 'very_poor'],
    default: 'good'
  },
  timestamp: { 
    type: Date, 
    default: Date.now, 
    index: true 
  },
  source: { 
    type: String, 
    default: 'airgradient',
    enum: [
      'airgradient',           // Source générique 
      'airgradient_real',      // Vraies données API AirGradient
      'airgradient_simulated', // Données simulées réalistes
      'openaq',                // Données OpenAQ
      'openaq_v3',            // Données OpenAQ v3
      'esp32',                 // Capteurs ESP32 directs
      'manual'                 // Saisie manuelle
    ]
  }
}, {
  timestamps: true
});

// Index composés pour performance
SensorDataSchema.index({ sensorId: 1, timestamp: -1 });
SensorDataSchema.index({ 'location.city': 1, timestamp: -1 });
SensorDataSchema.index({ qualityLevel: 1, timestamp: -1 });
SensorDataSchema.index({ source: 1, timestamp: -1 }); // Index sur la source

// Fonction utilitaire pour calculer l'AQI
function calculateAQI(pm25, pm10, co2) {
  let aqi = 0;
  let level = 'good';
  
  // PM2.5 (standards EPA actualisés)
  if (pm25 <= 12) {
    aqi = Math.max(aqi, (pm25 / 12) * 50);
  } else if (pm25 <= 35.4) {
    aqi = Math.max(aqi, 50 + ((pm25 - 12) / (35.4 - 12)) * 50);
    level = 'moderate';
  } else if (pm25 <= 55.4) {
    aqi = Math.max(aqi, 100 + ((pm25 - 35.4) / (55.4 - 35.4)) * 50);
    level = 'poor';
  } else {
    aqi = Math.max(aqi, 150 + ((pm25 - 55.4) / (150.4 - 55.4)) * 50);
    level = 'very_poor';
  }
  
  // PM10 (standards OMS)
  if (pm10 > 54) {
    aqi = Math.max(aqi, 100 + ((pm10 - 54) / (154 - 54)) * 50);
    if (level === 'good') level = 'moderate';
  } else if (pm10 > 20) {
    aqi = Math.max(aqi, 50 + ((pm10 - 20) / (54 - 20)) * 50);
    if (level === 'good') level = 'moderate';
  }
  
  // CO2 (pour espaces intérieurs)
  if (co2 > 1000) {
    aqi = Math.max(aqi, 100);
    if (level === 'good') level = 'moderate';
  }
  
  // Assurer qu'on ne dépasse pas les limites
  if (aqi > 300) level = 'very_poor';
  
  return { aqi: Math.round(aqi), level };
}

// Middleware pour calculer l'AQI automatiquement
SensorDataSchema.pre('save', function(next) {
  if (this.measurements && (this.measurements.pm25 || this.measurements.pm10)) {
    const { aqi, level } = calculateAQI(
      this.measurements.pm25 || 0,
      this.measurements.pm10 || 0,
      this.measurements.co2 || 400
    );
    this.airQualityIndex = aqi;
    this.qualityLevel = level;
  }
  next();
});

// Méthodes statiques utiles
SensorDataSchema.statics.getRecentBySensor = function(sensorId, hours = 24) {
  const startTime = new Date(Date.now() - hours * 60 * 60 * 1000);
  return this.find({
    sensorId,
    timestamp: { $gte: startTime }
  }).sort({ timestamp: -1 });
};

SensorDataSchema.statics.getLatestBySensor = function(sensorId) {
  return this.findOne({ sensorId }).sort({ timestamp: -1 });
};

SensorDataSchema.statics.getStatsByCity = function(city, hours = 24) {
  const startTime = new Date(Date.now() - hours * 60 * 60 * 1000);
  return this.aggregate([
    {
      $match: {
        'location.city': city,
        timestamp: { $gte: startTime }
      }
    },
    {
      $group: {
        _id: null,
        avgPM25: { $avg: '$measurements.pm25' },
        maxPM25: { $max: '$measurements.pm25' },
        minPM25: { $min: '$measurements.pm25' },
        avgAQI: { $avg: '$airQualityIndex' },
        count: { $sum: 1 }
      }
    }
  ]);
};

module.exports = mongoose.model('SensorData', SensorDataSchema);