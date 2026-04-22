// services/PredictionService.js - VERSION CORRIGÉE V3
// ✅ Fix: ajustements saisonniers déjà dans les features Flask → plus de double application
// ✅ Fix: ajustements météo lissés par jour, pas par heure
// ✅ Fix: fenêtre de comparaison élargie pour accuracy

const axios = require('axios');
const SensorData = require('../models/SensorData');
const Prediction = require('../models/Prediction');
const WeatherService = require('./WeatherService');

class PredictionService {
  constructor() {
    this.aiServiceUrl = process.env.AI_SERVICE_URL || 'http://localhost:5000';
    this.weatherService = new WeatherService();
    
    this.horizonConfig = {
      short: { max: 24, confidence: 0.80, name: 'court_terme' },
      medium: { max: 72, confidence: 0.65, name: 'moyen_terme' },
      long: { max: 168, confidence: 0.50, name: 'long_terme' }
    };
  }

  /**
   * Récupération adaptative des données historiques
   */
  async getHistoricalData(sensorId, targetHours = 168) {
    try {
      const historicalHours = Math.max(targetHours * 4, 168);
      const startDate = new Date(Date.now() - historicalHours * 60 * 60 * 1000);

      const data = await SensorData.find({
        sensorId,
        timestamp: { $gte: startDate }
      }).sort({ timestamp: 1 });

      console.log(`📊 ${data.length} points historiques récupérés (${historicalHours}h)`);

      if (data.length < 50) {
        console.warn(`⚠️ Données insuffisantes: ${data.length} points (min 50)`);
      }

      return data;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Features engineering avancé
   */
  async prepareAdvancedTrainingData(sensorId, hoursAhead = 168) {
    try {
      const historicalData = await this.getHistoricalData(sensorId, hoursAhead);

      if (historicalData.length < 50) {
        return {
          success: false,
          message: `Données insuffisantes (${historicalData.length}/50)`
        };
      }

      const enrichedData = historicalData.map((point, index) => {
        const ts = new Date(point.timestamp);
        const hour = ts.getHours();
        const day = ts.getDay();
        const month = ts.getMonth();

        return {
          timestamp: point.timestamp,
          pm25: point.measurements.pm25 || 0,
          pm10: point.measurements.pm10 || 0,
          temperature: point.measurements.temperature || 25,
          humidity: point.measurements.humidity || 50,
          co2: point.measurements.co2 || 400,
          
          // Features temporelles
          hour, dayOfWeek: day, month,
          isWeekend: [0, 6].includes(day) ? 1 : 0,
          isRushHour: [7, 8, 9, 17, 18, 19, 20].includes(hour) ? 1 : 0,
          isNight: (hour >= 22 || hour <= 6) ? 1 : 0,
          isDaytime: (hour >= 6 && hour <= 18) ? 1 : 0,
          isHarmattan: [11, 0, 1, 2].includes(month) ? 1 : 0,
          isRainySeason: [6, 7, 8, 9].includes(month) ? 1 : 0,
          isHotSeason: [3, 4, 5].includes(month) ? 1 : 0,
          
          // Lag features
          pm25_lag_1h: this.getLag(historicalData, index, 1),
          pm25_lag_3h: this.getLag(historicalData, index, 3),
          pm25_lag_6h: this.getLag(historicalData, index, 6),
          pm25_lag_24h: this.getLag(historicalData, index, 24),
          
          // Moyennes mobiles
          pm25_rolling_3h: this.getRolling(historicalData, index, 3),
          pm25_rolling_6h: this.getRolling(historicalData, index, 6),
          pm25_rolling_12h: this.getRolling(historicalData, index, 12),
          pm25_rolling_24h: this.getRolling(historicalData, index, 24),
          
          // Écarts-types
          pm25_std_6h: this.getStd(historicalData, index, 6),
          pm25_std_24h: this.getStd(historicalData, index, 24),
          
          // Différences
          pm25_diff_1h: this.getDiff(historicalData, index, 1),
          pm25_diff_3h: this.getDiff(historicalData, index, 3),
          pm25_diff_24h: this.getDiff(historicalData, index, 24),
          
          // Min/Max
          pm25_min_24h: this.getMin(historicalData, index, 24),
          pm25_max_24h: this.getMax(historicalData, index, 24),
          
          // Ratio
          pm25_pm10_ratio: point.measurements.pm10 > 0 ? 
            (point.measurements.pm25 / point.measurements.pm10) : 0.5
        };
      });

      // Météo
      const location = await this.getSensorLocation(sensorId);
      let weatherData = null;

      if (location?.city) {
        try {
          const weather = await this.weatherService.getCurrentWeather(location.city);
          if (weather.success) {
            weatherData = weather.data.current;
            console.log(`🌤️ Météo récupérée pour ${location.city}`);
          }
        } catch (e) {}
      }

      if (weatherData) {
        enrichedData.forEach(p => {
          p.wind_speed = weatherData.wind?.speed_kmh || 10;
          p.wind_direction = weatherData.wind?.direction_degrees || 0;
          p.pressure = weatherData.pressure || 1013;
          p.precipitation = weatherData.precipitation || 0;
          p.cloud_cover = weatherData.cloud_cover || 50;
        });
      }

      // Nettoyer NaN
      const cleaned = enrichedData.map(p => {
        const clean = {};
        for (const [k, v] of Object.entries(p)) {
          clean[k] = (k === 'timestamp') ? v : (isFinite(v) ? v : 0);
        }
        return clean;
      });

      console.log(`✅ ${cleaned.length} points avec ${Object.keys(cleaned[0]).length} features`);

      return {
        success: true,
        data: cleaned,
        featuresCount: Object.keys(cleaned[0]).length,
        hasWeather: weatherData !== null
      };
    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  // Utilitaires features
  getLag(data, idx, hours) {
    return (idx >= hours) ? (data[idx - hours]?.measurements?.pm25 || 0) : 0;
  }

  getRolling(data, idx, window) {
    if (idx < window) return 0;
    let sum = 0, count = 0;
    for (let i = idx - window; i <= idx; i++) {
      const v = data[i]?.measurements?.pm25;
      if (v !== undefined && isFinite(v)) { sum += v; count++; }
    }
    return count > 0 ? sum / count : 0;
  }

  getStd(data, idx, window) {
    if (idx < window) return 0;
    const vals = [];
    for (let i = idx - window; i <= idx; i++) {
      const v = data[i]?.measurements?.pm25;
      if (v !== undefined && isFinite(v)) vals.push(v);
    }
    if (vals.length < 2) return 0;
    const mean = vals.reduce((a, b) => a + b) / vals.length;
    const variance = vals.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / vals.length;
    return Math.sqrt(variance);
  }

  getDiff(data, idx, hours) {
    const curr = data[idx]?.measurements?.pm25 || 0;
    const prev = this.getLag(data, idx, hours);
    return curr - prev;
  }

  getMin(data, idx, window) {
    if (idx < window) return 0;
    let min = Infinity;
    for (let i = idx - window; i <= idx; i++) {
      const v = data[i]?.measurements?.pm25;
      if (v !== undefined && isFinite(v)) min = Math.min(min, v);
    }
    return min === Infinity ? 0 : min;
  }

  getMax(data, idx, window) {
    if (idx < window) return 0;
    let max = -Infinity;
    for (let i = idx - window; i <= idx; i++) {
      const v = data[i]?.measurements?.pm25;
      if (v !== undefined && isFinite(v)) max = Math.max(max, v);
    }
    return max === -Infinity ? 0 : max;
  }

  async getSensorLocation(sensorId) {
    try {
      const data = await SensorData.findOne({ sensorId })
        .sort({ timestamp: -1 })
        .select('location');
      return data?.location || null;
    } catch (e) {
      return null;
    }
  }

  /**
   * Appel service IA
   */
  async callAdvancedAIService(trainingData, hoursAhead) {
    try {
      console.log(`🤖 Appel IA avec ${trainingData.length} points...`);

      const response = await axios.post(
        `${this.aiServiceUrl}/predict`,
        {
          historical_data: trainingData,
          hours_ahead: hoursAhead,
          features: Object.keys(trainingData[0]).filter(k => k !== 'timestamp')
        },
        { timeout: 120000 }
      );

      if (response.data?.predictions) {
        console.log(`✅ ${response.data.predictions.length} prédictions reçues`);
        return {
          success: true,
          predictions: response.data.predictions,
          model_info: response.data.model_info || {}
        };
      }

      return { success: false, message: 'Format invalide' };
    } catch (error) {
      console.error('❌ Erreur IA:', error.message);
      return { success: false, message: error.message, usesFallback: true };
    }
  }

  /**
   * ✅ PRINCIPAL: Génération de prédictions
   */
  async generatePrediction(sensorId, hoursAhead = 168) {
    try {
      console.log(`\n🔮 Génération ${sensorId} (${hoursAhead}h)...`);

      // 1. Données enrichies
      const prep = await this.prepareAdvancedTrainingData(sensorId, hoursAhead);
      if (!prep.success) return prep;

      // 2. IA ou fallback
      let aiResult = await this.callAdvancedAIService(prep.data, hoursAhead);
      if (!aiResult.success || aiResult.usesFallback) {
        console.warn('⚠️ Mode fallback');
        aiResult = await this.generateFallbackPredictions(sensorId, hoursAhead);
      }
      if (!aiResult.success) return aiResult;

      // 3. Prévisions météo (par jour, pas par heure)
      const location = await this.getSensorLocation(sensorId);
      let forecast = null;
      if (location?.city) {
        try {
          const f = await this.weatherService.getForecast(location.city, null, null, Math.ceil(hoursAhead / 24));
          if (f.success) forecast = f.data;
        } catch (e) {}
      }

      // 4. Enrichir & sauvegarder
      const enriched = await this.enrichPredictions(aiResult.predictions, sensorId, forecast, prep.data);
      const saved = [];
      for (const p of enriched) {
        try {
          saved.push(await new Prediction(p).save());
        } catch (e) {}
      }

      // 5. Stats
      const avgPM25 = saved.reduce((s, p) => s + p.predictedPM25, 0) / saved.length;
      const avgConf = saved.reduce((s, p) => s + p.confidence, 0) / saved.length;

      console.log(`✅ ${saved.length} prédictions | PM2.5: ${avgPM25.toFixed(1)} | Conf: ${(avgConf * 100).toFixed(1)}%`);

      return {
        success: true,
        predictions: saved,
        summary: {
          count: saved.length,
          avgPM25, 
          avgConfidence: avgConf,
          hasWeather: forecast !== null
        }
      };
    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  /**
   * ✅ FIX: Enrichissement SANS double ajustement saisonnier
   * Les features isHarmattan/isRainySeason sont déjà passées au Flask
   * qui les intègre dans le modèle. On n'applique plus de multiplicateur ici.
   * 
   * Les ajustements météo sont lissés : on calcule un facteur par jour
   * puis on l'applique uniformément sur les 24h de ce jour.
   */
  async enrichPredictions(rawPreds, sensorId, forecast, hist) {
    const now = new Date();
    const location = await this.getSensorLocation(sensorId);

    // ← Précalculer les facteurs météo PAR JOUR (pas par heure)
    const weatherFactors = this.calculateDailyWeatherFactors(forecast);

    return rawPreds.map((pred, i) => {
      const predFor = new Date(pred.timestamp || (now.getTime() + (i + 1) * 3600000));
      const hoursAhead = Math.round((predFor - now) / 3600000);

      let horizon = 'long';
      if (hoursAhead <= 24) horizon = 'short';
      else if (hoursAhead <= 72) horizon = 'medium';

      let conf = pred.confidence || this.horizonConfig[horizon].confidence;
      let pm25 = pred.predicted_pm25 || pred.pm25 || 0;

      // ← SEUL ajustement restant : météo, par jour
      const dayIdx = Math.floor(hoursAhead / 24);
      const dayFactor = weatherFactors[dayIdx];
      if (dayFactor) {
        pm25 *= dayFactor.pm25Factor;
        conf *= dayFactor.confFactor;
      }

      // ← SUPPRIMÉ : les ajustements saisonniers (Harmattan, pluies)
      // Le Flask reçoit déjà isHarmattan et isRainySeason comme features
      // et les intègre directement dans le modèle ensemble.
      // Les appliquer ici aussi = double comptage.

      pm25 = Math.max(5, Math.min(500, pm25));
      conf = Math.max(0.2, Math.min(0.95, conf));

      const p = new Prediction({
        sensorId,
        predictionFor: predFor,
        hoursAhead,
        predictedPM25: pm25,
        predictedAQI: this.calculateAQI(pm25),
        confidence: conf,
        horizon,
        location: location ? {
          name: location.name,
          city: location.city,
          coordinates: location.coordinates
        } : undefined,
        weatherAdjusted: forecast !== null,
        modelMetrics: {
          version: 'enhanced_v3',
          algorithm: pred.model_type || 'ensemble'
        }
      });

      p.calculateQuality();
      p.generateRecommendations();
      return p;
    });
  }

  /**
   * ✅ NOUVEAU: Calcule un facteur météo unique par jour
   * Évite les ajustements contradictoires heure par heure
   */
  calculateDailyWeatherFactors(forecast) {
    const factors = {};
    if (!forecast?.daily) return factors;

    forecast.daily.forEach((day, idx) => {
      let pm25Factor = 1.0;
      let confFactor = 1.0;

      // Stagnation atmosphérique (vent faible + humidité élevée)
      if (day.wind?.avg_speed < 5 && day.humidity?.avg > 80) {
        pm25Factor *= 1.12;
        confFactor *= 0.95;
      }

      // Vent fort (peut disperser OU importer des pollutants selon la saison)
      if (day.wind?.avg_speed > 25) {
        // En Harmattan (nov-fév), le vent fort = plus de sable/pollution
        const month = new Date().getMonth();
        if ([11, 0, 1, 2].includes(month)) {
          pm25Factor *= 1.15;
        } else {
          pm25Factor *= 0.95; // Sinon le vent disperse
        }
        confFactor *= 0.90;
      }

      // Pluie (lessive atmosphérique)
      if (day.precipitation > 5) {
        pm25Factor *= 0.75;
        confFactor *= 1.05; // La pluie rend la prédiction plus fiable
      }

      // Chaleur extrême
      if (day.temperature?.avg > 35) {
        pm25Factor *= 1.08;
      }

      factors[idx] = { pm25Factor, confFactor };
    });

    return factors;
  }

  calculateAQI(pm25) {
    if (pm25 <= 12) return Math.round((50 / 12) * pm25);
    if (pm25 <= 35.4) return Math.round(((100 - 51) / (35.4 - 12.1)) * (pm25 - 12.1) + 51);
    if (pm25 <= 55.4) return Math.round(((150 - 101) / (55.4 - 35.5)) * (pm25 - 35.5) + 101);
    if (pm25 <= 150.4) return Math.round(((200 - 151) / (150.4 - 55.5)) * (pm25 - 55.5) + 151);
    if (pm25 <= 250.4) return Math.round(((300 - 201) / (250.4 - 150.5)) * (pm25 - 150.5) + 201);
    return Math.round(((500 - 301) / (500 - 250.5)) * (pm25 - 250.5) + 301);
  }

  /**
   * Fallback statistique
   */
  async generateFallbackPredictions(sensorId, hoursAhead) {
    try {
      const hist = await this.getHistoricalData(sensorId, 168);
      if (hist.length < 24) return { success: false, message: 'Données insuffisantes' };

      const hourlyAvgs = new Array(24).fill(0).map(() => []);
      hist.forEach(p => {
        hourlyAvgs[new Date(p.timestamp).getHours()].push(p.measurements.pm25);
      });

      const means = hourlyAvgs.map(v => 
        v.length > 0 ? v.reduce((a, b) => a + b) / v.length : 15
      );

      const preds = [];
      const now = new Date();
      for (let i = 1; i <= hoursAhead; i++) {
        const t = new Date(now.getTime() + i * 3600000);
        preds.push({
          timestamp: t,
          predicted_pm25: means[t.getHours()] * (1 + (Math.random() - 0.5) * 0.2),
          confidence: 0.40,
          model_type: 'fallback'
        });
      }

      return { success: true, predictions: preds };
    } catch (e) {
      return { success: false, message: e.message };
    }
  }

  /**
   * ✅ FIX: Fenêtre de comparaison élargie de ±10min à ±30min
   * Avant, si la donnée réelle arrivait à 14:05 et la prédiction visait 14:00,
   * avec ±10min on ratait parfois → accuracy = 0.0%
   */
  async evaluatePredictionAccuracy(sensorId, hours = 24) {
    try {
      const now = new Date();
      const start = new Date(now.getTime() - hours * 3600000);

      const preds = await Prediction.find({
        sensorId,
        predictionFor: { $gte: start, $lte: now },
        createdAt: { $lte: new Date(now.getTime() - 3600000) }
      });

      if (preds.length === 0) {
        return { sensorId, evaluatedPredictions: 0, accuracy: '0.0' };
      }

      let totalError = 0, totalPctError = 0, count = 0;

      for (const p of preds) {
        // ← Fenêtre élargie à ±30 minutes
        const actual = await SensorData.findOne({
          sensorId,
          timestamp: {
            $gte: new Date(p.predictionFor.getTime() - 1800000),  // -30min
            $lte: new Date(p.predictionFor.getTime() + 1800000)   // +30min
          }
        }).sort({ timestamp: 1 }); // Prendre la plus proche chronologiquement

        if (actual) {
          const actualPM25 = actual.measurements.pm25 || 0;
          const err = Math.abs(actualPM25 - p.predictedPM25);
          totalError += err;
          totalPctError += actualPM25 > 0 ? (err / actualPM25) * 100 : 0;
          count++;
        }
      }

      if (count === 0) return { sensorId, evaluatedPredictions: 0, accuracy: '0.0' };

      const mape = totalPctError / count;
      const acc = Math.max(0, 100 - mape);

      let perf = 'poor';
      if (acc >= 80) perf = 'excellent';
      else if (acc >= 60) perf = 'good';
      else if (acc >= 40) perf = 'fair';

      return {
        sensorId,
        evaluatedPredictions: count,
        accuracy: acc.toFixed(1) + '%',
        metrics: { mae: (totalError / count).toFixed(2), mape: mape.toFixed(2) },
        performance: perf
      };
    } catch (e) {
      return { sensorId, evaluatedPredictions: 0, accuracy: '0.0', error: e.message };
    }
  }

  async checkAIServiceHealth() {
    try {
      // Timeout 60s pour absorber le cold start du tier gratuit Render (~50s)
      const r = await axios.get(`${this.aiServiceUrl}/`, { timeout: 60000 });
      return { available: r.status === 200 };
    } catch (e) {
      return { available: false, error: e.message };
    }
  }

  async cleanupOldPredictions(daysOld = 7) {
    const cutoff = new Date(Date.now() - daysOld * 86400000);
    const r = await Prediction.deleteMany({ predictionFor: { $lt: cutoff } });
    return r.deletedCount;
  }

  async getFuturePredictions(sensorId, hours = 168) {
    const now = new Date();
    const end = new Date(now.getTime() + hours * 3600000);
    const p = await Prediction.find({
      sensorId,
      predictionFor: { $gte: now, $lte: end }
    }).sort({ predictionFor: 1 });
    return { success: true, data: p };
  }

  async getRecentPredictions(sensorId, limit = 24) {
    const p = await Prediction.find({ sensorId }).sort({ createdAt: -1 }).limit(limit);
    return { success: true, data: p };
  }
}

module.exports = PredictionService;