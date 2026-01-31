// services/PredictionService.js - Service avancé pour prédictions 7 jours
const axios = require('axios');
const SensorData = require('../models/SensorData');
const Prediction = require('../models/Prediction');

class PredictionService {
  constructor() {
    this.flaskAPIUrl = process.env.FLASK_API_URL || 'http://localhost:5000';
    this.minDataPoints = 48;
    this.maxHoursAhead = 168; // 7 jours
    this.confidenceDecayRate = 0.03; // Dégradation confiance par heure
  }
  
  // Générer prédictions pour 7 jours avec métadonnées enrichies
  async generatePrediction(sensorId, hoursAhead = 168) {
    try {
      console.log(`🔮 Génération prédiction ${hoursAhead}h pour ${sensorId}...`);
      
      if (hoursAhead > this.maxHoursAhead) {
        hoursAhead = this.maxHoursAhead;
      }
      
      // Récupérer données historiques étendues (14 jours pour meilleure prédiction 7j)
      const historicalData = await this.getHistoricalData(sensorId, 336); // 14 jours
      
      if (historicalData.length < this.minDataPoints) {
        return {
          success: false,
          message: `Données insuffisantes: ${historicalData.length}/${this.minDataPoints}`
        };
      }
      
      console.log(`📊 ${historicalData.length} points de données trouvés`);
      
      // Préparer données pour IA
      const trainingData = this.prepareAdvancedTrainingData(historicalData);
      
      // Appeler service IA
      const aiResponse = await this.callAdvancedAIService(sensorId, trainingData, hoursAhead);
      
      if (!aiResponse.success) {
        console.log('⚠️ Service IA indisponible, utilisation du fallback');
        return aiResponse;
      }
      
      console.log(`✅ ${aiResponse.predictions.length} prédictions reçues du service IA`);
      
      // Enrichir prédictions avec métadonnées avancées
      const enrichedPredictions = await this.enrichPredictions(
        sensorId, 
        aiResponse.predictions,
        historicalData
      );
      
      // Sauvegarder prédictions enrichies
      const savedPredictions = await this.saveEnrichedPredictions(sensorId, enrichedPredictions);
      
      // Générer résumés
      const weeklySummary = this.generateWeeklySummary(savedPredictions);
      const alerts = this.detectPredictiveAlerts(savedPredictions);
      
      console.log(`💾 ${savedPredictions.length} prédictions sauvegardées`);
      
      return {
        success: true,
        predictions: savedPredictions,
        summary: weeklySummary,
        alerts: alerts,
        model_performance: aiResponse.model_performance,
        statistics: aiResponse.statistics,
        confidence: aiResponse.statistics?.confidence?.mean || 0.5,
        modelVersion: aiResponse.model_performance?.version || '3.0-optimized-7days'
      };
      
    } catch (error) {
      console.error(`❌ Erreur prédiction ${sensorId}:`, error.message);
      return {
        success: false,
        message: `Erreur génération prédiction: ${error.message}`
      };
    }
  }
  
  // Récupérer données historiques
  async getHistoricalData(sensorId, hours = 336) {
    try {
      const startTime = new Date(Date.now() - hours * 60 * 60 * 1000);
      
      const data = await SensorData
        .find({
          sensorId,
          timestamp: { $gte: startTime },
          'measurements.pm25': { $exists: true, $ne: null }
        })
        .sort({ timestamp: 1 })
        .lean();
      
      return data;
    } catch (error) {
      console.error('❌ Erreur récupération données:', error.message);
      return [];
    }
  }
  
  // Préparer données pour IA
  prepareAdvancedTrainingData(historicalData) {
    return historicalData.map(record => {
      const date = new Date(record.timestamp);
      
      return {
        timestamp: record.timestamp,
        pm25: record.measurements.pm25 || 0,
        pm10: record.measurements.pm10 || 0,
        co2: record.measurements.co2 || 400,
        temperature: record.measurements.temperature || 25,
        humidity: record.measurements.humidity || 50,
        tvoc: record.measurements.tvoc || 0,
        nox: record.measurements.nox || 0,
        hour: date.getHours(),
        dayOfWeek: date.getDay(),
        month: date.getMonth() + 1,
        aqi: record.airQualityIndex || 0,
        qualityLevel: record.qualityLevel || 'good'
      };
    });
  }
  
  // Appeler service IA
  async callAdvancedAIService(sensorId, trainingData, hoursAhead) {
    try {
      console.log(`🤖 Appel service IA: ${this.flaskAPIUrl}/predict`);
      
      const response = await axios.post(`${this.flaskAPIUrl}/predict`, {
        sensorId,
        data: trainingData,
        hours_ahead: hoursAhead,
        use_ensemble: true
      }, {
        timeout: 90000, // 90s pour prédictions 7j
        headers: { 'Content-Type': 'application/json' }
      });
      
      if (response.data.success) {
        console.log(`✅ Service IA répondu avec succès`);
        return {
          success: true,
          predictions: response.data.predictions,
          model_performance: response.data.model_performance,
          statistics: response.data.statistics,
          timestamp: response.data.timestamp
        };
      } else {
        console.log(`⚠️ Service IA a retourné une erreur: ${response.data.error}`);
        return {
          success: false,
          message: response.data.error || 'Erreur service IA'
        };
      }
      
    } catch (error) {
      console.error('❌ Erreur service IA:', error.message);
      if (error.code === 'ECONNREFUSED') {
        console.log('⚠️ Service IA non disponible, passage en mode fallback');
      }
      return this.fallbackPrediction(trainingData, hoursAhead);
    }
  }
  
  // Prédiction fallback améliorée pour 7 jours
  fallbackPrediction(trainingData, hoursAhead) {
    try {
      console.log('🔄 Mode fallback pour prédiction 7 jours...');
      
      const recentData = trainingData.slice(-168); // 7 derniers jours
      const veryRecentData = trainingData.slice(-24); // 24 dernières heures
      
      // Analyses statistiques
      const avgPM25 = recentData.reduce((sum, d) => sum + d.pm25, 0) / recentData.length;
      const trendPM25 = this.calculateTrend(recentData.map(d => d.pm25));
      const volatility = this.calculateVolatility(veryRecentData.map(d => d.pm25));
      
      // Patterns hebdomadaires
      const weeklyPattern = this.extractWeeklyPattern(recentData);
      const hourlyPattern = this.extractHourlyPattern(recentData);
      
      const predictions = [];
      const now = new Date();
      
      for (let i = 1; i <= hoursAhead; i++) {
        const futureTime = new Date(now.getTime() + i * 60 * 60 * 1000);
        const futureHour = futureTime.getHours();
        const futureDayOfWeek = futureTime.getDay();
        
        // Facteurs temporels
        const hourlyFactor = hourlyPattern[futureHour] || 1.0;
        const weeklyFactor = weeklyPattern[futureDayOfWeek] || 1.0;
        
        // Prédiction de base
        let predictedPM25 = avgPM25 + (trendPM25 * i);
        predictedPM25 *= hourlyFactor * weeklyFactor;
        
        // Variabilité
        const randomVariation = (Math.random() - 0.5) * volatility * 0.3;
        predictedPM25 += randomVariation;
        
        // Contraintes réalistes
        predictedPM25 = Math.max(0, Math.min(500, predictedPM25));
        
        // Confiance dégradée avec le temps
        const baseConfidence = 0.65;
        const confidence = Math.max(0.2, baseConfidence - (i * this.confidenceDecayRate));
        
        // Intervalle de confiance
        const uncertaintyWidth = volatility * (1 + i / 24); // Croît avec le temps
        const confidenceInterval = {
          lower: Math.max(0, predictedPM25 - uncertaintyWidth),
          upper: Math.min(500, predictedPM25 + uncertaintyWidth),
          range: uncertaintyWidth * 2
        };
        
        predictions.push({
          hour_ahead: i,
          predicted_pm25: Math.round(predictedPM25 * 100) / 100,
          predicted_aqi: this.calculateAQI(predictedPM25),
          confidence: Math.round(confidence * 1000) / 1000,
          confidence_interval: confidenceInterval,
          uncertainty: {
            value: uncertaintyWidth,
            level: this.getUncertaintyLevel(i, confidence)
          },
          timestamp: futureTime.toISOString(),
          is_extreme: predictedPM25 > avgPM25 * 1.5,
          contributing_factors: this.getSimpleFactors(futureHour, futureDayOfWeek),
          modelVersion: 'fallback-2.1',
          horizon: i <= 24 ? 'short' : (i <= 72 ? 'medium' : 'long')
        });
      }
      
      return {
        success: true,
        predictions,
        model_performance: {
          version: 'fallback-2.1',
          mae: 5.0,
          rmse: 7.0,
          r2_score: 0.6
        },
        statistics: {
          mean: predictions.reduce((sum, p) => sum + p.predicted_pm25, 0) / predictions.length,
          trend: trendPM25 > 0 ? 'increasing' : 'decreasing',
          volatility: volatility,
          confidence: {
            mean: predictions.reduce((sum, p) => sum + p.confidence, 0) / predictions.length,
            min: Math.min(...predictions.map(p => p.confidence)),
            max: Math.max(...predictions.map(p => p.confidence))
          }
        }
      };
      
    } catch (error) {
      console.error('❌ Erreur fallback prediction:', error.message);
      return {
        success: false,
        message: 'Erreur prédiction fallback'
      };
    }
  }
  
  // Extraire pattern hebdomadaire
  extractWeeklyPattern(data) {
    const dayAverages = {};
    const dayCounts = {};
    
    data.forEach(d => {
      const day = d.dayOfWeek;
      if (!dayAverages[day]) {
        dayAverages[day] = 0;
        dayCounts[day] = 0;
      }
      dayAverages[day] += d.pm25;
      dayCounts[day]++;
    });
    
    const overallAvg = data.reduce((sum, d) => sum + d.pm25, 0) / data.length;
    const pattern = {};
    
    for (let day = 0; day < 7; day++) {
      if (dayCounts[day] > 0) {
        const dayAvg = dayAverages[day] / dayCounts[day];
        pattern[day] = dayAvg / overallAvg; // Facteur relatif
      } else {
        pattern[day] = 1.0;
      }
    }
    
    return pattern;
  }
  
  // Extraire pattern horaire
  extractHourlyPattern(data) {
    const hourAverages = {};
    const hourCounts = {};
    
    data.forEach(d => {
      const hour = d.hour;
      if (!hourAverages[hour]) {
        hourAverages[hour] = 0;
        hourCounts[hour] = 0;
      }
      hourAverages[hour] += d.pm25;
      hourCounts[hour]++;
    });
    
    const overallAvg = data.reduce((sum, d) => sum + d.pm25, 0) / data.length;
    const pattern = {};
    
    for (let hour = 0; hour < 24; hour++) {
      if (hourCounts[hour] > 0) {
        const hourAvg = hourAverages[hour] / hourCounts[hour];
        pattern[hour] = hourAvg / overallAvg;
      } else {
        pattern[hour] = 1.0;
      }
    }
    
    return pattern;
  }
  
  // 🔧 CORRECTION : Enrichir prédictions avec mapping cohérent
  async enrichPredictions(sensorId, predictions, historicalData) {
    try {
      const recentAvg = historicalData.slice(-24).reduce((sum, d) => sum + d.measurements.pm25, 0) / 24;
      const weekAvg = historicalData.slice(-168).reduce((sum, d) => sum + d.measurements.pm25, 0) / Math.min(168, historicalData.length);
      
      return predictions.map(pred => {
        const predTime = new Date(pred.timestamp);
        const hour = predTime.getHours();
        const dayOfWeek = predTime.getDay();
        
        // 🔧 CORRECTION : Extraction cohérente des valeurs du service IA
        const pm25 = pred.predicted_pm25;
        const aqi = pred.predicted_aqi;
        const hoursAhead = pred.hour_ahead;
        
        // Calculer qualité prédite
        const quality = this.determineQuality(pm25);
        
        // Facteurs enrichis
        const enrichedFactors = {
          weather: {
            impact: 'neutral' // Sera enrichi avec météo réelle si disponible
          },
          historical: {
            avgPM25Last24h: recentAvg,
            avgPM25Last7d: weekAvg,
            trend: pm25 > recentAvg ? 'increasing' : 'decreasing',
            trendStrength: (pm25 - recentAvg) / recentAvg,
            seasonalFactor: this.getSeasonalFactor(predTime.getMonth() + 1)
          },
          temporalPatterns: {
            hourOfDay: hour,
            dayOfWeek: dayOfWeek,
            isWeekend: dayOfWeek === 0 || dayOfWeek === 6,
            isRushHour: (hour >= 7 && hour <= 9) || (hour >= 17 && hour <= 19),
            isNightTime: hour >= 22 || hour <= 5,
            hourlyFactor: this.getHourlyFactor(hour),
            weeklyFactor: this.getWeeklyFactor(dayOfWeek)
          },
          environmental: {
            isHarmattan: this.isHarmattanSeason(predTime.getMonth() + 1),
            isDrySeason: this.isDrySeason(predTime.getMonth() + 1),
            isRainySeason: this.isRainySeason(predTime.getMonth() + 1),
            trafficLevel: this.estimateTrafficLevel(hour, dayOfWeek)
          },
          contributing_factors: pred.contributing_factors || []
        };
        
        // Calculer incertitude
        const uncertainty = pred.uncertainty || {
          value: pred.confidence_interval ? pred.confidence_interval.range / 2 : 10,
          level: this.getUncertaintyLevel(hoursAhead, pred.confidence)
        };
        
        // Générer alertes prédictives
        const predictiveAlerts = this.generatePredictiveAlerts(pm25, quality.level, hoursAhead);
        
        // 🔧 CORRECTION : Retour cohérent avec le schéma Mongoose
        return {
          predictedPM25: pm25,
          predictedAQI: aqi,
          predictionFor: predTime,
          hoursAhead: hoursAhead,
          confidence: pred.confidence,
          confidenceInterval: pred.confidence_interval || {
            lower: pm25 * 0.8,
            upper: pm25 * 1.2,
            range: pm25 * 0.4
          },
          uncertainty: uncertainty,
          predictedQuality: quality,
          factors: enrichedFactors,
          predictiveAlerts: predictiveAlerts,
          requiresAction: ['unhealthy', 'very_unhealthy', 'hazardous'].includes(quality.level),
          isExtreme: pm25 > 100,
          modelMetrics: {
            version: pred.modelVersion || '3.0-optimized-7days',
            algorithm: 'ensemble'
          },
          source: 'ai_model'
        };
      });
      
    } catch (error) {
      console.error('❌ Erreur enrichissement prédictions:', error.message);
      return predictions;
    }
  }
  
  // Déterminer qualité de l'air
  determineQuality(pm25) {
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
  }
  
  // Générer alertes prédictives
  generatePredictiveAlerts(pm25, qualityLevel, hoursAhead) {
    const alerts = [];
    
    if (pm25 > 150) {
      alerts.push({
        type: 'threshold_exceeded',
        severity: 'critical',
        message: `Pic de pollution prévu (${Math.round(pm25)} µg/m³) dans ${hoursAhead}h`,
        threshold: 150,
        probability: 0.8
      });
    } else if (pm25 > 100) {
      alerts.push({
        type: 'spike',
        severity: 'high',
        message: `Niveau élevé prévu (${Math.round(pm25)} µg/m³) dans ${hoursAhead}h`,
        threshold: 100,
        probability: 0.7
      });
    } else if (pm25 > 55) {
      alerts.push({
        type: 'sustained_high',
        severity: 'medium',
        message: `Qualité dégradée prévue dans ${hoursAhead}h`,
        threshold: 55,
        probability: 0.6
      });
    }
    
    return alerts;
  }
  
  // Obtenir niveau d'incertitude
  getUncertaintyLevel(hoursAhead, confidence) {
    if (hoursAhead <= 24) {
      return confidence > 0.7 ? 'low' : 'medium';
    } else if (hoursAhead <= 72) {
      return confidence > 0.6 ? 'medium' : 'high';
    } else {
      return confidence > 0.5 ? 'high' : 'very_high';
    }
  }
  
  // Facteur saisonnier
  getSeasonalFactor(month) {
    // Harmattan: nov-mars (mois 11, 12, 1, 2, 3)
    if (month >= 11 || month <= 3) {
      return 1.3; // +30% pendant Harmattan
    }
    // Saison des pluies: juin-septembre
    if (month >= 6 && month <= 9) {
      return 0.8; // -20% pendant saison des pluies
    }
    return 1.0;
  }
  
  // Estimer niveau de trafic
  estimateTrafficLevel(hour, dayOfWeek) {
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    
    if (isWeekend) {
      return 'low';
    }
    
    if ((hour >= 7 && hour <= 9) || (hour >= 17 && hour <= 19)) {
      return 'very_high'; // Heures de pointe
    }
    
    if (hour >= 10 && hour <= 16) {
      return 'high'; // Journée
    }
    
    if (hour >= 20 || hour <= 6) {
      return 'low'; // Nuit
    }
    
    return 'medium';
  }
  
  // Saisons
  isHarmattanSeason(month) {
    return month >= 11 || month <= 3;
  }
  
  isDrySeason(month) {
    return month >= 11 || month <= 5;
  }
  
  isRainySeason(month) {
    return month >= 6 && month <= 10;
  }
  
  // Facteurs horaires
  getHourlyFactor(hour) {
    if ((hour >= 7 && hour <= 9) || (hour >= 17 && hour <= 19)) {
      return 1.3; // Heures de pointe
    }
    if (hour >= 22 || hour <= 5) {
      return 0.8; // Nuit
    }
    return 1.0;
  }
  
  // Facteurs hebdomadaires
  getWeeklyFactor(dayOfWeek) {
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      return 0.85; // Weekend
    }
    if (dayOfWeek === 5) {
      return 1.1; // Vendredi
    }
    return 1.0;
  }
  
  // Facteurs simples
  getSimpleFactors(hour, dayOfWeek) {
    const factors = [];
    
    if ((hour >= 7 && hour <= 9) || (hour >= 17 && hour <= 19)) {
      factors.push({
        factor: 'Heure de pointe',
        impact: 'high',
        value: 'Active'
      });
    }
    
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      factors.push({
        factor: 'Weekend',
        impact: 'medium',
        value: 'Réduction attendue'
      });
    }
    
    return factors;
  }
  
  // Calculer tendance
  calculateTrend(values) {
    const n = values.length;
    if (n < 2) return 0;
    
    const x = Array.from({length: n}, (_, i) => i);
    const sumX = x.reduce((a, b) => a + b, 0);
    const sumY = values.reduce((a, b) => a + b, 0);
    const sumXY = x.reduce((acc, xi, i) => acc + xi * values[i], 0);
    const sumXX = x.reduce((acc, xi) => acc + xi * xi, 0);
    
    return (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
  }
  
  // Calculer volatilité
  calculateVolatility(values) {
    if (values.length < 2) return 0;
    
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / values.length;
    return Math.sqrt(variance);
  }
  
  // Calculer AQI
  calculateAQI(pm25) {
    const breakpoints = [
      [0, 12.0, 0, 50],
      [12.1, 35.4, 51, 100],
      [35.5, 55.4, 101, 150],
      [55.5, 150.4, 151, 200],
      [150.5, 250.4, 201, 300],
      [250.5, 350.4, 301, 400],
      [350.5, 500.4, 401, 500]
    ];
    
    for (const [bpLow, bpHigh, aqiLow, aqiHigh] of breakpoints) {
      if (bpLow <= pm25 && pm25 <= bpHigh) {
        return Math.round(((aqiHigh - aqiLow) / (bpHigh - bpLow)) * (pm25 - bpLow) + aqiLow);
      }
    }
    return 500;
  }
  
  // Sauvegarder prédictions enrichies
  async saveEnrichedPredictions(sensorId, enrichedPredictions) {
    try {
      const savedPredictions = [];
      
      for (const pred of enrichedPredictions) {
        // Supprimer ancienne prédiction pour même timestamp si existe
        await Prediction.deleteOne({
          sensorId,
          predictionFor: pred.predictionFor
        });
        
        const prediction = new Prediction({
          sensorId,
          ...pred
        });
        
        await prediction.save();
        savedPredictions.push(prediction);
      }
      
      console.log(`💾 ${savedPredictions.length} prédictions sauvegardées pour ${sensorId}`);
      return savedPredictions;
      
    } catch (error) {
      console.error('❌ Erreur sauvegarde prédictions:', error.message);
      return [];
    }
  }
  
  // Générer résumé hebdomadaire
  generateWeeklySummary(predictions) {
    if (!predictions || predictions.length === 0) {
      return null;
    }
    
    // Grouper par jour
    const dailyGroups = {};
    
    predictions.forEach(pred => {
      const day = pred.predictionFor.toISOString().split('T')[0];
      if (!dailyGroups[day]) {
        dailyGroups[day] = {
          date: day,
          predictions: [],
          avgPM25: 0,
          maxPM25: 0,
          minPM25: Infinity,
          qualities: {},
          alerts: []
        };
      }
      
      const group = dailyGroups[day];
      group.predictions.push(pred);
      group.avgPM25 += pred.predictedPM25;
      group.maxPM25 = Math.max(group.maxPM25, pred.predictedPM25);
      group.minPM25 = Math.min(group.minPM25, pred.predictedPM25);
      
      const quality = pred.predictedQuality?.level || 'moderate';
      group.qualities[quality] = (group.qualities[quality] || 0) + 1;
      
      if (pred.predictiveAlerts && pred.predictiveAlerts.length > 0) {
        group.alerts.push(...pred.predictiveAlerts);
      }
    });
    
    // Calculer statistiques par jour
    const dailySummary = Object.keys(dailyGroups).map(day => {
      const group = dailyGroups[day];
      group.avgPM25 /= group.predictions.length;
      
      // Qualité dominante
      const dominantQuality = Object.keys(group.qualities).reduce((a, b) => 
        group.qualities[a] > group.qualities[b] ? a : b
      );
      
      return {
        date: day,
        avgPM25: Math.round(group.avgPM25 * 100) / 100,
        maxPM25: Math.round(group.maxPM25 * 100) / 100,
        minPM25: Math.round(group.minPM25 * 100) / 100,
        dominantQuality,
        totalPredictions: group.predictions.length,
        alerts: group.alerts.length,
        requiresAction: ['unhealthy', 'very_unhealthy', 'hazardous'].includes(dominantQuality)
      };
    });
    
    // Statistiques globales
    const overallStats = {
      totalPredictions: predictions.length,
      avgPM25: predictions.reduce((sum, p) => sum + p.predictedPM25, 0) / predictions.length,
      maxPM25: Math.max(...predictions.map(p => p.predictedPM25)),
      minPM25: Math.min(...predictions.map(p => p.predictedPM25)),
      avgConfidence: predictions.reduce((sum, p) => sum + p.confidence, 0) / predictions.length,
      daysWithHighPollution: dailySummary.filter(d => d.avgPM25 > 55).length,
      daysRequiringAction: dailySummary.filter(d => d.requiresAction).length
    };
    
    return {
      period: {
        start: predictions[0].predictionFor,
        end: predictions[predictions.length - 1].predictionFor,
        days: dailySummary.length
      },
      dailySummary,
      overallStats
    };
  }
  
  // Détecter alertes prédictives
  detectPredictiveAlerts(predictions) {
    const alerts = [];
    
    // Détecter pics
    predictions.forEach((pred, index) => {
      if (pred.predictedPM25 > 100) {
        alerts.push({
          type: 'peak',
          severity: pred.predictedPM25 > 150 ? 'critical' : 'high',
          time: pred.predictionFor,
          hoursAhead: pred.hoursAhead,
          value: pred.predictedPM25,
          message: `Pic de pollution prévu: ${Math.round(pred.predictedPM25)} µg/m³`
        });
      }
    });
    
    // Détecter périodes prolongées de mauvaise qualité
    let consecutiveBad = 0;
    let badPeriodStart = null;
    
    predictions.forEach((pred, index) => {
      if (pred.predictedPM25 > 55) {
        if (consecutiveBad === 0) {
          badPeriodStart = pred.predictionFor;
        }
        consecutiveBad++;
      } else {
        if (consecutiveBad >= 6) { // 6h consécutives
          alerts.push({
            type: 'sustained_period',
            severity: 'medium',
            start: badPeriodStart,
            duration: consecutiveBad,
            message: `Période prolongée de mauvaise qualité: ${consecutiveBad}h`
          });
        }
        consecutiveBad = 0;
        badPeriodStart = null;
      }
    });
    
    // Détection changements rapides
    for (let i = 1; i < predictions.length; i++) {
      const change = predictions[i].predictedPM25 - predictions[i-1].predictedPM25;
      const percentChange = Math.abs(change / predictions[i-1].predictedPM25);
      
      if (percentChange > 0.5 && Math.abs(change) > 20) {
        alerts.push({
          type: 'rapid_change',
          severity: 'medium',
          time: predictions[i].predictionFor,
          change: Math.round(change),
          percentChange: Math.round(percentChange * 100),
          message: `Changement rapide prévu: ${change > 0 ? '+' : ''}${Math.round(change)} µg/m³`
        });
      }
    }
    
    return alerts;
  }
  
  // Méthodes utilitaires
  
  async getRecentPredictions(sensorId, limit = 10) {
    try {
      return await Prediction
        .find({ sensorId })
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean();
    } catch (error) {
      console.error('❌ Erreur récupération prédictions:', error.message);
      return [];
    }
  }
  
  async getFuturePredictions(sensorId, hours = 168) {
    try {
      const now = new Date();
      const futureTime = new Date(now.getTime() + hours * 60 * 60 * 1000);
      
      return await Prediction
        .find({
          sensorId,
          predictionFor: { $gte: now, $lte: futureTime }
        })
        .sort({ predictionFor: 1 })
        .lean();
    } catch (error) {
      console.error('❌ Erreur récupération prédictions futures:', error.message);
      return [];
    }
  }
  
  async getWeeklySummary(sensorId) {
    try {
      return await Prediction.getWeeklySummary(sensorId);
    } catch (error) {
      console.error('❌ Erreur récupération résumé:', error.message);
      return null;
    }
  }
  
  async evaluatePredictionAccuracy(sensorId, hours = 24) {
    try {
      const cutoffDate = new Date(Date.now() - hours * 60 * 60 * 1000);
      
      const predictions = await Prediction.find({
        sensorId,
        createdAt: { $gte: cutoffDate },
        'actualValue.pm25': { $exists: true, $ne: null }
      });
      
      if (predictions.length === 0) {
        return {
          totalPredictions: 0,
          evaluatedPredictions: 0,
          averageError: null,
          averagePercentError: null,
          accuracy: null
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
    } catch (error) {
      console.error('❌ Erreur évaluation précision:', error.message);
      return {
        totalPredictions: 0,
        evaluatedPredictions: 0,
        averageError: null,
        averagePercentError: null,
        accuracy: null
      };
    }
  }
  
  async cleanupOldPredictions(daysOld = 7) {
    try {
      const cutoffDate = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000);
      
      const result = await Prediction.deleteMany({
        createdAt: { $lt: cutoffDate }
      });
      
      console.log(`🗑️ ${result.deletedCount} anciennes prédictions supprimées`);
      return result.deletedCount;
    } catch (error) {
      console.error('❌ Erreur nettoyage prédictions:', error.message);
      return 0;
    }
  }
  
  async checkAIServiceHealth() {
    try {
      const response = await axios.get(`${this.flaskAPIUrl}/`, { timeout: 5000 });
      return {
        available: true,
        status: response.status,
        service_info: response.data,
        message: 'Service IA disponible'
      };
    } catch (error) {
      return {
        available: false,
        error: error.message,
        message: 'Service IA indisponible'
      };
    }
  }
}

module.exports = PredictionService;
