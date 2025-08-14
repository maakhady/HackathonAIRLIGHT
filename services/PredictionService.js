// services/PredictionService.js - CORRIGÉ POUR JAVASCRIPT
const axios = require('axios');
const SensorData = require('../models/SensorData');
const Prediction = require('../models/Prediction');

class PredictionService {
  constructor() {
    this.flaskAPIUrl = process.env.FLASK_API_URL || 'http://localhost:5000';
    this.minDataPoints = 48;
    this.maxHoursAhead = 72;
  }
  
  // Générer une prédiction avec le modèle amélioré
  async generatePrediction(sensorId, hoursAhead = 1) {
    try {
      console.log(`🤖 Génération prédiction avancée pour ${sensorId}...`);
      
      // Validation des paramètres
      if (hoursAhead > this.maxHoursAhead) {
        return {
          success: false,
          message: `Maximum ${this.maxHoursAhead} heures de prédiction supportées`
        };
      }
      
      // Récupérer les données historiques (plus de données pour le nouveau modèle)
      const historicalData = await this.getHistoricalData(sensorId, 168); // 7 jours
      
      if (historicalData.length < this.minDataPoints) {
        return {
          success: false,
          message: `Pas assez de données historiques (${historicalData.length}/${this.minDataPoints})`
        };
      }
      
      // Préparer les données pour l'IA améliorée
      const trainingData = this.prepareAdvancedTrainingData(historicalData);
      
      // Appeler le service IA avec les nouvelles options
      const aiResponse = await this.callAdvancedAIService(sensorId, trainingData, hoursAhead);
      
      if (!aiResponse.success) {
        return aiResponse;
      }
      
      // Sauvegarder les prédictions avec nouvelles métadonnées
      const savedPredictions = await this.saveAdvancedPredictions(sensorId, aiResponse);
      
      return {
        success: true,
        predictions: savedPredictions,
        model_performance: aiResponse.model_performance,
        statistics: aiResponse.statistics,
        confidence: aiResponse.statistics?.mean_confidence || 0.5,
        modelVersion: aiResponse.model_performance?.version || '2.0'
      };
      
    } catch (error) {
      console.error(`❌ Erreur prédiction ${sensorId}:`, error.message);
      return {
        success: false,
        message: 'Erreur lors de la génération de prédiction'
      };
    }
  }
  
  // Récupérer les données historiques avec plus de contexte
  async getHistoricalData(sensorId, hours = 168) {
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
      console.error('❌ Erreur récupération données historiques:', error.message);
      return [];
    }
  }
  
  // Préparer les données pour le modèle IA amélioré
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
        
        // Features temporelles pour le nouveau modèle
        hour: date.getHours(),
        dayOfWeek: date.getDay(),
        month: date.getMonth() + 1,
        
        // AQI et niveau de qualité
        aqi: record.airQualityIndex || 0,
        qualityLevel: record.qualityLevel || 'good'
      };
    });
  }
  
  // Appeler le service IA amélioré
  async callAdvancedAIService(sensorId, trainingData, hoursAhead) {
    try {
      const response = await axios.post(`${this.flaskAPIUrl}/predict`, {
        sensorId,
        data: trainingData,
        hours_ahead: hoursAhead,
        use_ensemble: true // Activer l'ensemble de modèles
      }, {
        timeout: 60000, // Augmenté pour les modèles plus complexes
        headers: { 'Content-Type': 'application/json' }
      });
      
      if (response.data.success) {
        return {
          success: true,
          predictions: response.data.predictions,
          model_performance: response.data.model_performance,
          statistics: response.data.statistics,
          timestamp: response.data.timestamp
        };
      } else {
        return {
          success: false,
          message: response.data.error || 'Erreur du service IA'
        };
      }
      
    } catch (error) {
      console.error('❌ Erreur appel service IA avancé:', error.message);
      
      // Fallback vers prédiction simple
      return this.fallbackPrediction(trainingData, hoursAhead);
    }
  }
  
  // Prédiction de fallback améliorée
  fallbackPrediction(trainingData, hoursAhead) {
    try {
      console.log('⚠️ Service IA indisponible, utilisation du fallback amélioré...');
      
      // Analyse des tendances récentes
      const recentData = trainingData.slice(-48); // 48 dernières heures
      const veryRecentData = trainingData.slice(-12); // 12 dernières heures
      
      // Calculs statistiques avancés
      const avgPM25 = recentData.reduce((sum, d) => sum + d.pm25, 0) / recentData.length;
      const trendPM25 = this.calculateTrend(recentData.map(d => d.pm25));
      const volatility = this.calculateVolatility(veryRecentData.map(d => d.pm25));
      
      // Facteurs saisonniers et temporels
      const currentHour = new Date().getHours();
      const hourlyFactor = this.getHourlyFactor(currentHour);
      const dayOfWeek = new Date().getDay();
      const weeklyFactor = this.getWeeklyFactor(dayOfWeek);
      
      const predictions = [];
      for (let i = 1; i <= hoursAhead; i++) {
        const futureHour = (currentHour + i) % 24;
        const futureHourFactor = this.getHourlyFactor(futureHour);
        
        // Prédiction avec tendance et facteurs temporels
        let predictedPM25 = avgPM25 + (trendPM25 * i);
        predictedPM25 *= futureHourFactor * weeklyFactor;
        
        // Ajouter de la variabilité basée sur la volatilité historique
        const randomVariation = (Math.random() - 0.5) * volatility * 0.5;
        predictedPM25 += randomVariation;
        
        // Contraintes réalistes
        predictedPM25 = Math.max(0, Math.min(500, predictedPM25));
        
        const predictedAQI = this.calculateAQI(predictedPM25);
        const predictionTime = new Date(Date.now() + i * 60 * 60 * 1000);
        
        // Confidence basée sur la volatilité et la quantité de données
        const confidence = Math.max(0.2, Math.min(0.6, 
          0.4 * (1 - volatility / avgPM25) * (recentData.length / 48)
        ));
        
        predictions.push({
          hour_ahead: i,
          predicted_pm25: Math.round(predictedPM25 * 100) / 100,
          predicted_aqi: Math.round(predictedAQI * 10) / 10,
          confidence: Math.round(confidence * 1000) / 1000,
          timestamp: predictionTime.toISOString(),
          is_extreme: predictedPM25 > avgPM25 * 2,
          contributing_factors: this.getSimpleFactors(futureHour, dayOfWeek),
          modelVersion: 'fallback-2.0'
        });
      }
      
      return {
        success: true,
        predictions,
        model_performance: {
          version: 'fallback-2.0',
          confidence: Math.round(predictions.reduce((sum, p) => sum + p.confidence, 0) / predictions.length * 1000) / 1000
        },
        statistics: {
          mean: Math.round(predictions.reduce((sum, p) => sum + p.predicted_pm25, 0) / predictions.length * 100) / 100,
          trend: trendPM25 > 0 ? 'increasing' : 'decreasing'
        }
      };
      
    } catch (error) {
      console.error('❌ Erreur fallback prediction:', error.message);
      return {
        success: false,
        message: 'Erreur lors de la prédiction de fallback'
      };
    }
  }
  
  // Calculer la tendance (régression linéaire simple)
  calculateTrend(values) {
    const n = values.length;
    const x = Array.from({length: n}, (_, i) => i);
    const sumX = x.reduce((a, b) => a + b, 0);
    const sumY = values.reduce((a, b) => a + b, 0);
    const sumXY = x.reduce((acc, xi, i) => acc + xi * values[i], 0);
    const sumXX = x.reduce((acc, xi) => acc + xi * xi, 0);
    
    return (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
  }
  
  // Calculer la volatilité (écart-type)
  calculateVolatility(values) {
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / values.length;
    return Math.sqrt(variance);
  }
  
  // Facteurs horaires (basés sur les patterns typiques de pollution)
  getHourlyFactor(hour) {
    // Heures de pointe: 7-9h et 17-19h
    if ((hour >= 7 && hour <= 9) || (hour >= 17 && hour <= 19)) {
      return 1.3; // +30% pendant les heures de pointe
    }
    // Nuit: 22h-5h
    if (hour >= 22 || hour <= 5) {
      return 0.8; // -20% la nuit
    }
    // Journée normale
    return 1.0;
  }
  
  // Facteurs hebdomadaires
  getWeeklyFactor(dayOfWeek) {
    // Weekend (samedi=6, dimanche=0)
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      return 0.85; // -15% le weekend
    }
    // Vendredi
    if (dayOfWeek === 5) {
      return 1.1; // +10% le vendredi
    }
    return 1.0;
  }
  
  // Facteurs simples pour le fallback
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
  
  // ✅ CORRIGÉ: Calculer l'AQI avec syntaxe JavaScript correcte
  calculateAQI(pm25) {
    // ✅ Utilisation d'arrays JavaScript au lieu de tuples Python
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
        return ((aqiHigh - aqiLow) / (bpHigh - bpLow)) * (pm25 - bpLow) + aqiLow;
      }
    }
    return 500;
  }
  
  // Sauvegarder les prédictions avec métadonnées enrichies
  async saveAdvancedPredictions(sensorId, aiResponse) {
    try {
      const savedPredictions = [];
      
      for (const pred of aiResponse.predictions) {
        const prediction = new Prediction({
          sensorId,
          predictedPM25: pred.predicted_pm25,
          predictedAQI: pred.predicted_aqi,
          predictionFor: new Date(pred.timestamp),
          confidence: pred.confidence,
          
          // Nouvelles métadonnées du modèle amélioré
          factors: {
            contributing_factors: pred.contributing_factors || [],
            model_contributions: pred.model_contributions || {},
            is_extreme: pred.is_extreme || false,
            uncertainty: pred.uncertainty || 0,
            confidence_interval: pred.confidence_interval || []
          },
          
          modelVersion: pred.modelVersion || '2.0'
        });
        
        await prediction.save();
        savedPredictions.push(prediction);
      }
      
      console.log(`✅ ${savedPredictions.length} prédictions avancées sauvegardées pour ${sensorId}`);
      return savedPredictions;
      
    } catch (error) {
      console.error('❌ Erreur sauvegarde prédictions:', error.message);
      return [];
    }
  }
  
  // Nouvelles méthodes pour les fonctionnalités avancées
  
  // Détecter les anomalies dans les données
  async detectAnomalies(sensorId, hours = 168) {
    try {
      const historicalData = await this.getHistoricalData(sensorId, hours);
      const trainingData = this.prepareAdvancedTrainingData(historicalData);
      
      const response = await axios.post(`${this.flaskAPIUrl}/analyze/anomalies`, {
        data: trainingData
      }, {
        timeout: 30000,
        headers: { 'Content-Type': 'application/json' }
      });
      
      return response.data;
      
    } catch (error) {
      console.error('❌ Erreur détection anomalies:', error.message);
      return { success: false, error: error.message };
    }
  }
  
  // Analyser les patterns temporels
  async analyzePatterns(sensorId, hours = 168) {
    try {
      const historicalData = await this.getHistoricalData(sensorId, hours);
      const trainingData = this.prepareAdvancedTrainingData(historicalData);
      
      const response = await axios.post(`${this.flaskAPIUrl}/analyze/patterns`, {
        data: trainingData
      }, {
        timeout: 30000,
        headers: { 'Content-Type': 'application/json' }
      });
      
      return response.data;
      
    } catch (error) {
      console.error('❌ Erreur analyse patterns:', error.message);
      return { success: false, error: error.message };
    }
  }
  
  // Générer un rapport complet
  async generateReport(sensorId, hours = 720) { // 30 jours par défaut
    try {
      const historicalData = await this.getHistoricalData(sensorId, hours);
      const trainingData = this.prepareAdvancedTrainingData(historicalData);
      
      const response = await axios.post(`${this.flaskAPIUrl}/export/report`, {
        sensorId,
        data: trainingData
      }, {
        timeout: 60000,
        headers: { 'Content-Type': 'application/json' }
      });
      
      return response.data;
      
    } catch (error) {
      console.error('❌ Erreur génération rapport:', error.message);
      return { success: false, error: error.message };
    }
  }
  
  // Réentraîner le modèle avec de nouvelles données
  async retrainModel(sensorId, hours = 168) {
    try {
      const historicalData = await this.getHistoricalData(sensorId, hours);
      const trainingData = this.prepareAdvancedTrainingData(historicalData);
      
      const response = await axios.post(`${this.flaskAPIUrl}/model/retrain`, {
        data: trainingData,
        use_ensemble: true
      }, {
        timeout: 120000, // 2 minutes pour le réentraînement
        headers: { 'Content-Type': 'application/json' }
      });
      
      return response.data;
      
    } catch (error) {
      console.error('❌ Erreur réentraînement:', error.message);
      return { success: false, error: error.message };
    }
  }
  
  // Obtenir les informations du modèle
  async getModelInfo() {
    try {
      const response = await axios.get(`${this.flaskAPIUrl}/model/info`, {
        timeout: 10000
      });
      
      return response.data;
      
    } catch (error) {
      console.error('❌ Erreur info modèle:', error.message);
      return null;
    }
  }
  
  // Méthodes existantes (inchangées)
  async getRecentPredictions(sensorId, limit = 10) {
    try {
      const predictions = await Prediction
        .find({ sensorId })
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean();
      
      return predictions;
    } catch (error) {
      console.error('❌ Erreur récupération prédictions:', error.message);
      return [];
    }
  }
  
  async getFuturePredictions(sensorId) {
    try {
      const now = new Date();
      
      const predictions = await Prediction
        .find({
          sensorId,
          predictionFor: { $gt: now }
        })
        .sort({ predictionFor: 1 })
        .lean();
      
      return predictions;
    } catch (error) {
      console.error('❌ Erreur récupération prédictions futures:', error.message);
      return [];
    }
  }
  
  async evaluatePredictionAccuracy(sensorId, hours = 24) {
    try {
      const cutoffTime = new Date(Date.now() - hours * 60 * 60 * 1000);
      
      const pastPredictions = await Prediction
        .find({
          sensorId,
          predictionFor: { 
            $gte: cutoffTime,
            $lt: new Date()
          }
        })
        .lean();
      
      if (pastPredictions.length === 0) {
        return { accuracy: 0, evaluatedPredictions: 0 };
      }
      
      let totalError = 0;
      let evaluatedCount = 0;
      
      for (const prediction of pastPredictions) {
        const actualData = await SensorData.findOne({
          sensorId,
          timestamp: {
            $gte: new Date(prediction.predictionFor.getTime() - 30 * 60 * 1000),
            $lte: new Date(prediction.predictionFor.getTime() + 30 * 60 * 1000)
          }
        });
        
        if (actualData && actualData.measurements.pm25) {
          const error = Math.abs(prediction.predictedPM25 - actualData.measurements.pm25);
          const relativeError = error / actualData.measurements.pm25;
          
          totalError += relativeError;
          evaluatedCount++;
        }
      }
      
      const accuracy = evaluatedCount > 0 ? 
        Math.max(0, 1 - (totalError / evaluatedCount)) : 0;
      
      return {
        accuracy: Math.round(accuracy * 100) / 100,
        evaluatedPredictions: evaluatedCount,
        totalPredictions: pastPredictions.length
      };
      
    } catch (error) {
      console.error('❌ Erreur évaluation précision:', error.message);
      return { accuracy: 0, evaluatedPredictions: 0 };
    }
  }
  
  async cleanupOldPredictions(daysOld = 7) {
    try {
      const cutoffDate = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000);
      
      const result = await Prediction.deleteMany({
        createdAt: { $lt: cutoffDate }
      });
      
      console.log(`🧹 ${result.deletedCount} anciennes prédictions supprimées`);
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