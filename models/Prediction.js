// models/Prediction.js - Modèle enrichi pour prédictions 7 jours avec métadonnées avancées
const mongoose = require('mongoose');

const PredictionSchema = new mongoose.Schema({
  // Identifiants
  sensorId: { 
    type: String, 
    required: true, 
    index: true 
  },
  
  // Valeurs prédites
  predictedPM25: { 
    type: Number, 
    required: true,
    min: 0 
  },
  predictedPM10: {
    type: Number,
    min: 0,
    default: null
  },
  predictedCO2: {
    type: Number,
    min: 300,
    default: null
  },
  predictedAQI: { 
    type: Number, 
    required: true,
    min: 0,
    max: 500 
  },
  
  // Qualité de l'air prédite
  predictedQuality: {
    level: {
      type: String,
      enum: ['good', 'moderate', 'poor', 'unhealthy', 'very_unhealthy', 'hazardous'],
      default: 'moderate'
    },
    description: String,
    color: String, // Code couleur pour UI (#00E400, #FFFF00, #FF7E00, #FF0000, #8F3F97, #7E0023)
    aqiRange: {
      min: Number,
      max: Number
    }
  },
  
  // Timing
  predictionFor: { 
    type: Date, 
    required: true,
    index: true 
  },
  hoursAhead: {
    type: Number,
    required: true,
    min: 1,
    max: 168 // 7 jours maximum
  },
  
  // Confiance et incertitude
  confidence: { 
    type: Number, 
    min: 0, 
    max: 1,
    default: 0.5 
  },
  confidenceInterval: {
    lower: Number, // PM2.5 minimum probable
    upper: Number, // PM2.5 maximum probable
    range: Number  // Taille de l'intervalle
  },
  uncertainty: {
    value: Number,
    level: {
      type: String,
      enum: ['low', 'medium', 'high', 'very_high']
    }
  },
  
  // Facteurs contributifs enrichis
  factors: {
    // Météo
    weather: {
      temperature: Number,
      humidity: Number,
      pressure: Number,
      windSpeed: Number,
      windDirection: String,
      precipitation: Number,
      cloudCover: Number,
      impact: {
        type: String,
        enum: ['favorable', 'neutral', 'unfavorable']
      }
    },
    
    // Historique
    historical: {
      avgPM25Last24h: Number,
      avgPM25Last7d: Number,
      trend: {
        type: String,
        enum: ['decreasing', 'stable', 'increasing', 'volatile']
      },
      trendStrength: Number, // -1 à +1
      seasonalFactor: Number
    },
    
    // Patterns temporels
    temporalPatterns: {
      hourOfDay: Number,
      dayOfWeek: Number,
      weekOfMonth: Number,
      isWeekend: Boolean,
      isRushHour: Boolean,
      isNightTime: Boolean,
      hourlyFactor: Number,   // Facteur multiplicatif horaire
      weeklyFactor: Number    // Facteur multiplicatif hebdomadaire
    },
    
    // Facteurs environnementaux
    environmental: {
      isHarmattan: Boolean,
      isDrySeason: Boolean,
      isRainySeason: Boolean,
      urbanDensity: String, // 'low', 'medium', 'high'
      proximityToIndustry: Boolean,
      trafficLevel: {
        type: String,
        enum: ['low', 'medium', 'high', 'very_high']
      }
    },
    
    // Facteurs contributifs principaux
    contributing_factors: [{
      factor: String,
      impact: {
        type: String,
        enum: ['low', 'medium', 'high', 'critical']
      },
      value: mongoose.Schema.Types.Mixed,
      confidence: Number,
      description: String
    }],
    
    // Contributions du modèle (pour explicabilité)
    model_contributions: {
      random_forest: Number,
      gradient_boosting: Number,
      lstm: Number,
      ensemble: Number
    }
  },
  
  // Alertes prédictives
  predictiveAlerts: [{
    type: {
      type: String,
      enum: ['spike', 'sustained_high', 'rapid_change', 'threshold_exceeded']
    },
    severity: {
      type: String,
      enum: ['low', 'medium', 'high', 'critical']
    },
    message: String,
    threshold: Number,
    probability: Number
  }],
  
  // Recommandations
  recommendations: [{
    category: {
      type: String,
      enum: ['health', 'activities', 'ventilation', 'protection']
    },
    priority: {
      type: String,
      enum: ['low', 'medium', 'high']
    },
    message: String,
    appliesTo: [String] // ['general', 'children', 'elderly', 'asthmatics', etc.]
  }],
  
  // Statistiques de prédiction
  statistics: {
    mean: Number,
    median: Number,
    std: Number,
    min: Number,
    max: Number,
    percentile25: Number,
    percentile75: Number
  },
  
  // Métriques du modèle
  modelMetrics: {
    version: { 
      type: String, 
      default: '2.0' 
    },
    algorithm: String, // 'ensemble', 'lstm', 'random_forest', etc.
    trainingAccuracy: Number,
    mae: Number, // Mean Absolute Error
    rmse: Number, // Root Mean Squared Error
    r2Score: Number,
    featureImportance: [{
      feature: String,
      importance: Number
    }]
  },
  
  // Comparaison avec prédictions précédentes
  previousPrediction: {
    value: Number,
    difference: Number,
    percentChange: Number
  },
  
  // Validation et correction
  actualValue: {
    pm25: Number,
    aqi: Number,
    measuredAt: Date,
    error: Number,
    percentError: Number
  },
  
  // Flags
  isExtreme: {
    type: Boolean,
    default: false
  },
  isAnomaly: {
    type: Boolean,
    default: false
  },
  requiresAction: {
    type: Boolean,
    default: false
  },
  
  // Métadonnées
  createdAt: { 
    type: Date, 
    default: Date.now, 
    index: true 
  },
  updatedAt: {
    type: Date,
    default: Date.now
  },
  source: {
    type: String,
    enum: ['ai_model', 'ensemble', 'fallback', 'manual'],
    default: 'ai_model'
  }
});

// Index composés pour requêtes rapides
PredictionSchema.index({ sensorId: 1, predictionFor: 1 }, { unique: true });
PredictionSchema.index({ sensorId: 1, createdAt: -1 });
PredictionSchema.index({ sensorId: 1, hoursAhead: 1 });
PredictionSchema.index({ predictionFor: 1, sensorId: 1 });
PredictionSchema.index({ 'predictedQuality.level': 1, predictionFor: 1 });
PredictionSchema.index({ isExtreme: 1, predictionFor: 1 });

// Méthodes d'instance

// Calculer la qualité de l'air prédite
PredictionSchema.methods.calculateQuality = function() {
  const pm25 = this.predictedPM25;
  
  if (pm25 <= 12) {
    return {
      level: 'good',
      description: 'Air de bonne qualité',
      color: '#00E400',
      aqiRange: { min: 0, max: 50 }
    };
  } else if (pm25 <= 35.4) {
    return {
      level: 'moderate',
      description: 'Air de qualité modérée',
      color: '#FFFF00',
      aqiRange: { min: 51, max: 100 }
    };
  } else if (pm25 <= 55.4) {
    return {
      level: 'poor',
      description: 'Air mauvais pour groupes sensibles',
      color: '#FF7E00',
      aqiRange: { min: 101, max: 150 }
    };
  } else if (pm25 <= 150.4) {
    return {
      level: 'unhealthy',
      description: 'Air malsain',
      color: '#FF0000',
      aqiRange: { min: 151, max: 200 }
    };
  } else if (pm25 <= 250.4) {
    return {
      level: 'very_unhealthy',
      description: 'Air très malsain',
      color: '#8F3F97',
      aqiRange: { min: 201, max: 300 }
    };
  } else {
    return {
      level: 'hazardous',
      description: 'Air dangereux',
      color: '#7E0023',
      aqiRange: { min: 301, max: 500 }
    };
  }
};

// Générer des recommandations
PredictionSchema.methods.generateRecommendations = function() {
  const recommendations = [];
  const level = this.predictedQuality?.level || 'moderate';
  
  if (level === 'good') {
    recommendations.push({
      category: 'activities',
      priority: 'low',
      message: 'Conditions idéales pour toutes activités extérieures',
      appliesTo: ['general']
    });
  } else if (level === 'moderate') {
    recommendations.push({
      category: 'health',
      priority: 'low',
      message: 'Acceptable pour la plupart des personnes',
      appliesTo: ['general']
    });
    recommendations.push({
      category: 'activities',
      priority: 'medium',
      message: 'Personnes très sensibles: envisager de limiter les efforts prolongés',
      appliesTo: ['asthmatics', 'heart_disease']
    });
  } else if (level === 'poor') {
    recommendations.push({
      category: 'health',
      priority: 'medium',
      message: 'Groupes sensibles peuvent ressentir des symptômes',
      appliesTo: ['children', 'elderly', 'asthmatics']
    });
    recommendations.push({
      category: 'activities',
      priority: 'medium',
      message: 'Limitez les activités extérieures prolongées si vous êtes sensible',
      appliesTo: ['children', 'elderly', 'asthmatics']
    });
  } else if (level === 'unhealthy') {
    recommendations.push({
      category: 'health',
      priority: 'high',
      message: 'Tout le monde peut ressentir des effets sur la santé',
      appliesTo: ['general']
    });
    recommendations.push({
      category: 'activities',
      priority: 'high',
      message: 'Évitez les activités extérieures intenses',
      appliesTo: ['general']
    });
    recommendations.push({
      category: 'ventilation',
      priority: 'high',
      message: 'Fermez les fenêtres, utilisez un purificateur d\'air',
      appliesTo: ['general']
    });
    recommendations.push({
      category: 'protection',
      priority: 'high',
      message: 'Port du masque recommandé à l\'extérieur',
      appliesTo: ['children', 'elderly', 'asthmatics']
    });
  } else if (level === 'very_unhealthy' || level === 'hazardous') {
    recommendations.push({
      category: 'health',
      priority: 'high',
      message: 'Avertissement sanitaire: tout le monde peut ressentir des effets graves',
      appliesTo: ['general']
    });
    recommendations.push({
      category: 'activities',
      priority: 'high',
      message: 'Restez à l\'intérieur et évitez tout effort physique',
      appliesTo: ['general']
    });
    recommendations.push({
      category: 'ventilation',
      priority: 'high',
      message: 'Fermez portes et fenêtres, utilisez obligatoirement un purificateur d\'air',
      appliesTo: ['general']
    });
    recommendations.push({
      category: 'protection',
      priority: 'high',
      message: 'Port du masque N95/FFP2 obligatoire si sortie nécessaire',
      appliesTo: ['general']
    });
  }
  
  return recommendations;
};

// Déterminer si action requise
PredictionSchema.methods.assessActionRequired = function() {
  const level = this.predictedQuality?.level;
  return ['unhealthy', 'very_unhealthy', 'hazardous'].includes(level);
};

// Calculer niveau d'incertitude
PredictionSchema.methods.calculateUncertaintyLevel = function() {
  if (this.hoursAhead <= 24) {
    return this.confidence > 0.7 ? 'low' : 'medium';
  } else if (this.hoursAhead <= 72) {
    return this.confidence > 0.6 ? 'medium' : 'high';
  } else {
    return this.confidence > 0.5 ? 'high' : 'very_high';
  }
};

// Middleware pre-save
PredictionSchema.pre('save', function(next) {
  // Calculer qualité si pas déjà fait
  if (!this.predictedQuality || !this.predictedQuality.level) {
    this.predictedQuality = this.calculateQuality();
  }
  
  // Générer recommandations si pas déjà fait
  if (!this.recommendations || this.recommendations.length === 0) {
    this.recommendations = this.generateRecommendations();
  }
  
  // Déterminer si action requise
  this.requiresAction = this.assessActionRequired();
  
  // Déterminer si valeur extrême
  this.isExtreme = this.predictedPM25 > 100;
  
  // Calculer niveau d'incertitude
  if (this.uncertainty && !this.uncertainty.level) {
    this.uncertainty.level = this.calculateUncertaintyLevel();
  }
  
  // Mettre à jour timestamp
  this.updatedAt = new Date();
  
  next();
});

// Méthodes statiques

// Obtenir prédictions futures pour un capteur
PredictionSchema.statics.getFuturePredictions = function(sensorId, hours = 168) {
  const now = new Date();
  const futureTime = new Date(now.getTime() + hours * 60 * 60 * 1000);
  
  return this.find({
    sensorId,
    predictionFor: { $gte: now, $lte: futureTime }
  }).sort({ predictionFor: 1 });
};

// Obtenir prédictions par niveau de qualité
PredictionSchema.statics.getByQualityLevel = function(sensorId, level, hours = 168) {
  const now = new Date();
  const futureTime = new Date(now.getTime() + hours * 60 * 60 * 1000);
  
  return this.find({
    sensorId,
    'predictedQuality.level': level,
    predictionFor: { $gte: now, $lte: futureTime }
  }).sort({ predictionFor: 1 });
};

// Obtenir alertes prédictives
PredictionSchema.statics.getPredictiveAlerts = function(sensorId, severity = null) {
  const now = new Date();
  
  const query = {
    sensorId,
    predictionFor: { $gte: now },
    'predictiveAlerts.0': { $exists: true }
  };
  
  if (severity) {
    query['predictiveAlerts.severity'] = severity;
  }
  
  return this.find(query).sort({ predictionFor: 1 });
};

// Statistiques de précision
PredictionSchema.statics.getAccuracyStats = async function(sensorId, days = 7) {
  const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  
  const predictions = await this.find({
    sensorId,
    createdAt: { $gte: cutoffDate },
    'actualValue.pm25': { $exists: true, $ne: null }
  });
  
  if (predictions.length === 0) {
    return {
      totalPredictions: 0,
      evaluatedPredictions: 0,
      averageError: null,
      averagePercentError: null
    };
  }
  
  const totalError = predictions.reduce((sum, pred) => sum + Math.abs(pred.actualValue.error || 0), 0);
  const totalPercentError = predictions.reduce((sum, pred) => sum + Math.abs(pred.actualValue.percentError || 0), 0);
  
  return {
    totalPredictions: predictions.length,
    evaluatedPredictions: predictions.length,
    averageError: totalError / predictions.length,
    averagePercentError: totalPercentError / predictions.length,
    accuracy: Math.max(0, 1 - (totalPercentError / predictions.length / 100))
  };
};

// Résumé hebdomadaire
PredictionSchema.statics.getWeeklySummary = async function(sensorId) {
  const now = new Date();
  const nextWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  
  const predictions = await this.find({
    sensorId,
    predictionFor: { $gte: now, $lte: nextWeek }
  }).sort({ predictionFor: 1 });
  
  if (predictions.length === 0) {
    return null;
  }
  
  // Grouper par jour
  const dailySummary = {};
  predictions.forEach(pred => {
    const day = pred.predictionFor.toISOString().split('T')[0];
    if (!dailySummary[day]) {
      dailySummary[day] = {
        date: day,
        predictions: [],
        avgPM25: 0,
        maxPM25: 0,
        minPM25: Infinity,
        dominantQuality: null
      };
    }
    dailySummary[day].predictions.push(pred);
    dailySummary[day].avgPM25 += pred.predictedPM25;
    dailySummary[day].maxPM25 = Math.max(dailySummary[day].maxPM25, pred.predictedPM25);
    dailySummary[day].minPM25 = Math.min(dailySummary[day].minPM25, pred.predictedPM25);
  });
  
  // Calculer moyennes et qualité dominante
  Object.keys(dailySummary).forEach(day => {
    const dayData = dailySummary[day];
    dayData.avgPM25 /= dayData.predictions.length;
    
    // Qualité dominante (la plus fréquente)
    const qualityCounts = {};
    dayData.predictions.forEach(pred => {
      const level = pred.predictedQuality?.level || 'moderate';
      qualityCounts[level] = (qualityCounts[level] || 0) + 1;
    });
    dayData.dominantQuality = Object.keys(qualityCounts).reduce((a, b) => 
      qualityCounts[a] > qualityCounts[b] ? a : b
    );
  });
  
  return {
    sensorId,
    period: { start: now, end: nextWeek },
    dailySummary: Object.values(dailySummary),
    overallStats: {
      totalPredictions: predictions.length,
      avgPM25: predictions.reduce((sum, p) => sum + p.predictedPM25, 0) / predictions.length,
      maxPM25: Math.max(...predictions.map(p => p.predictedPM25)),
      minPM25: Math.min(...predictions.map(p => p.predictedPM25)),
      avgConfidence: predictions.reduce((sum, p) => sum + (p.confidence || 0.5), 0) / predictions.length
    }
  };
};

module.exports = mongoose.model('Prediction', PredictionSchema);