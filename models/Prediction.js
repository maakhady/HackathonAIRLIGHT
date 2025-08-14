// models/Prediction.js - Modèle pour les prédictions IA
const mongoose = require('mongoose');

const PredictionSchema = new mongoose.Schema({
  sensorId: { 
    type: String, 
    required: true, 
    index: true 
  },
  predictedPM25: { 
    type: Number, 
    required: true,
    min: 0 
  },
  predictedAQI: { 
    type: Number, 
    required: true,
    min: 0,
    max: 500 
  },
  predictionFor: { 
    type: Date, 
    required: true,
    index: true 
  },
  confidence: { 
    type: Number, 
    min: 0, 
    max: 1,
    default: 0.5 
  },
  factors: {
    weather: {
      temperature: Number,
      humidity: Number,
      windSpeed: Number
    },
    historical: {
      avgPM25: Number,
      trend: String
    },
    trends: {
      hourlyPattern: [Number],
      weeklyPattern: [Number]
    }
  },
  modelVersion: { 
    type: String, 
    default: '1.0' 
  },
  createdAt: { 
    type: Date, 
    default: Date.now, 
    index: true 
  }
});

// Index composés
PredictionSchema.index({ sensorId: 1, predictionFor: 1 });
PredictionSchema.index({ sensorId: 1, createdAt: -1 });

module.exports = mongoose.model('Prediction', PredictionSchema);