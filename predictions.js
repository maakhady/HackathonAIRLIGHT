// routes/predictions.js - Routes fusionnées: existant + prédictions 7 jours (ORDRE CORRIGÉ)
const express = require('express');
const PredictionService = require('../services/PredictionService');
const AuthService = require('../services/AuthService');
const AlertService = require('../services/AlertService');
const Prediction = require('../models/Prediction');
const { triggerAlert } = require('../middleware/alertMiddleware');

const router = express.Router();
const predictionService = new PredictionService();
const authService = new AuthService();
const alertService = new AlertService();

// ==================== 🔧 ROUTES STATIQUES D'ABORD ====================
// IMPORTANT: Ces routes doivent être AVANT /:sensorId pour éviter les conflits

// GET /predictions/sensors - Liste des capteurs avec prédictions disponibles
router.get('/sensors', async (req, res) => {
  try {
    const sensorsWithPredictions = await Prediction.aggregate([
      {
        $match: {
          predictionFor: { $gt: new Date() }
        }
      },
      {
        $group: {
          _id: '$sensorId',
          latestPrediction: { $max: '$predictionFor' },
          predictionsCount: { $sum: 1 },
          avgConfidence: { $avg: '$confidence' },
          modelVersion: { $last: '$modelMetrics.version' },
          maxHoursAhead: { $max: '$hoursAhead' }
        }
      },
      {
        $sort: { latestPrediction: -1 }
      }
    ]);

    res.json({
      success: true,
      data: sensorsWithPredictions,
      count: sensorsWithPredictions.length
    });

  } catch (error) {
    console.error('❌ Erreur capteurs prédictions:', error.message);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération des capteurs'
    });
  }
});

// GET /predictions/stats/global - Statistiques globales des prédictions
router.get('/stats/global', async (req, res) => {
  try {
    const { period = '24h' } = req.query;

    let startDate;
    switch (period) {
      case '1h':
        startDate = new Date(Date.now() - 60 * 60 * 1000);
        break;
      case '24h':
        startDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
        break;
      case '7d':
        startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        break;
      case '30d':
        startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        break;
      default:
        startDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
    }

    const globalStats = await Prediction.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate }
        }
      },
      {
        $group: {
          _id: null,
          totalPredictions: { $sum: 1 },
          avgConfidence: { $avg: '$confidence' },
          avgPredictedPM25: { $avg: '$predictedPM25' },
          maxPredictedPM25: { $max: '$predictedPM25' },
          avgPredictedAQI: { $avg: '$predictedAQI' },
          maxPredictedAQI: { $max: '$predictedAQI' },
          avgHoursAhead: { $avg: '$hoursAhead' },
          extremePredictions: { $sum: { $cond: ['$isExtreme', 1, 0] } },
          actionRequired: { $sum: { $cond: ['$requiresAction', 1, 0] } }
        }
      }
    ]);

    const bySensor = await Prediction.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate }
        }
      },
      {
        $group: {
          _id: '$sensorId',
          predictions: { $sum: 1 },
          avgConfidence: { $avg: '$confidence' },
          avgPredictedPM25: { $avg: '$predictedPM25' },
          maxPredictedPM25: { $max: '$predictedPM25' },
          lastPrediction: { $max: '$predictionFor' },
          extremeCount: { $sum: { $cond: ['$isExtreme', 1, 0] } }
        }
      },
      {
        $sort: { predictions: -1 }
      }
    ]);

    const byQuality = await Prediction.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate },
          'predictedQuality.level': { $exists: true }
        }
      },
      {
        $group: {
          _id: '$predictedQuality.level',
          count: { $sum: 1 },
          avgPM25: { $avg: '$predictedPM25' },
          avgConfidence: { $avg: '$confidence' }
        }
      },
      {
        $sort: { count: -1 }
      }
    ]);

    const timeEvolution = await Prediction.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate }
        }
      },
      {
        $group: {
          _id: {
            year: { $year: '$createdAt' },
            month: { $month: '$createdAt' },
            day: { $dayOfMonth: '$createdAt' },
            hour: { $hour: '$createdAt' }
          },
          predictions: { $sum: 1 },
          avgConfidence: { $avg: '$confidence' },
          avgPredictedPM25: { $avg: '$predictedPM25' },
          extremeCount: { $sum: { $cond: ['$isExtreme', 1, 0] } }
        }
      },
      {
        $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1, '_id.hour': 1 }
      }
    ]);

    res.json({
      success: true,
      period,
      data: {
        global: globalStats[0] || {},
        bySensor: bySensor,
        byQuality: byQuality,
        timeEvolution: timeEvolution
      }
    });

  } catch (error) {
    console.error('❌ Erreur stats globales prédictions:', error.message);
    res.status(500).json({
      success: false,
      message: 'Erreur lors du calcul des statistiques'
    });
  }
});

// GET /predictions/ai-service/health - Vérifier l'état du service IA
router.get('/ai-service/health', async (req, res) => {
  try {
    const health = await predictionService.checkAIServiceHealth();
    
    res.json({
      success: true,
      data: health
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la vérification du service IA'
    });
  }
});

// POST /predictions/batch/generate - Générer des prédictions pour tous les capteurs
router.post('/batch/generate', authService.requireAdmin.bind(authService), async (req, res) => {
  try {
    const { hoursAhead = 168 } = req.body;

    const SensorData = require('../models/SensorData');
    const activeSensors = await SensorData.distinct('sensorId', {
      timestamp: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
    });

    const results = [];
    let successCount = 0;
    let errorCount = 0;
    let totalPredictions = 0;
    let totalAlerts = 0;

    for (const sensorId of activeSensors) {
      try {
        const result = await predictionService.generatePrediction(sensorId, hoursAhead);
        
        if (result.success) {
          successCount++;
          totalPredictions += result.predictions?.length || 0;
          const alerts = await checkPredictionAlerts(sensorId, result.predictions);
          totalAlerts += alerts;
        } else {
          errorCount++;
        }

        results.push({
          sensorId,
          success: result.success,
          message: result.message,
          predictionsCount: result.predictions ? result.predictions.length : 0,
          summary: result.summary || null
        });

        await new Promise(resolve => setTimeout(resolve, 2000));

      } catch (error) {
        errorCount++;
        results.push({
          sensorId,
          success: false,
          message: error.message
        });
      }
    }

    res.json({
      success: true,
      message: `Prédictions générées: ${successCount} réussies, ${errorCount} échouées`,
      summary: {
        totalSensors: activeSensors.length,
        successful: successCount,
        errors: errorCount,
        totalPredictions,
        totalAlerts,
        hoursAhead
      },
      details: results
    });

  } catch (error) {
    console.error('❌ Erreur génération batch:', error.message);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la génération en lot'
    });
  }
});

// DELETE /predictions/cleanup - Nettoyer les anciennes prédictions
router.delete('/cleanup', authService.requireAdmin.bind(authService), async (req, res) => {
  try {
    const { daysOld = 7 } = req.query;
    const deletedCount = await predictionService.cleanupOldPredictions(parseInt(daysOld));

    res.json({
      success: true,
      message: `${deletedCount} ancienne(s) prédiction(s) supprimée(s)`,
      deletedCount
    });

  } catch (error) {
    console.error('❌ Erreur nettoyage prédictions:', error.message);
    res.status(500).json({
      success: false,
      message: 'Erreur lors du nettoyage'
    });
  }
});

// POST /predictions/test - Tester le service de prédiction (MODE DEV)
if (process.env.NODE_ENV === 'development') {
  router.post('/test', authService.requireAdmin.bind(authService), async (req, res) => {
    try {
      const { sensorId = 'TEST_SENSOR_001', hoursAhead = 168 } = req.body;
      const result = await predictionService.generatePrediction(sensorId, hoursAhead);

      res.json({
        success: true,
        message: 'Test de prédiction effectué',
        testSensorId: sensorId,
        hoursAhead,
        result: result
      });

    } catch (error) {
      console.error('❌ Erreur test prédiction:', error.message);
      res.status(500).json({
        success: false,
        message: 'Erreur lors du test'
      });
    }
  });
}

// ==================== 🔧 ROUTES AVEC PARAMÈTRES APRÈS ====================
// Ces routes doivent être APRÈS les routes statiques

// GET /predictions/:sensorId - Obtenir les prédictions d'un capteur
router.get('/:sensorId', async (req, res) => {
  try {
    const { sensorId } = req.params;
    const { type = 'future', limit = 24, hours = 168 } = req.query;

    let predictions;
    
    if (type === 'future') {
      predictions = await predictionService.getFuturePredictions(sensorId, parseInt(hours));
    } else if (type === 'recent') {
      predictions = await predictionService.getRecentPredictions(sensorId, parseInt(limit));
    } else {
      predictions = await Prediction
        .find({ sensorId })
        .sort({ predictionFor: type === 'asc' ? 1 : -1 })
        .limit(parseInt(limit));
    }

    const accuracy = await predictionService.evaluatePredictionAccuracy(sensorId, 24);

    res.json({
      success: true,
      data: predictions,
      accuracy: accuracy,
      count: predictions.length,
      maxHoursAhead: predictions.length > 0 ? Math.max(...predictions.map(p => p.hoursAhead || 1)) : 0
    });

  } catch (error) {
    console.error('❌ Erreur prédictions capteur:', error.message);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération des prédictions'
    });
  }
});

// POST /predictions/:sensorId/generate - Générer une prédiction
router.post('/:sensorId/generate', authService.authenticateToken.bind(authService), async (req, res) => {
  try {
    const { sensorId } = req.params;
    const { hoursAhead = 168 } = req.body;

    if (hoursAhead < 1 || hoursAhead > 168) {
      return res.status(400).json({
        success: false,
        message: 'hoursAhead doit être entre 1 et 168 heures (7 jours)'
      });
    }

    const result = await predictionService.generatePrediction(sensorId, hoursAhead);

    if (result.success) {
      await checkPredictionAlerts(sensorId, result.predictions);
      
      res.status(201).json({
        ...result,
        summary: result.summary || null,
        alerts: result.alerts || []
      });
    } else {
      res.status(400).json(result);
    }

  } catch (error) {
    console.error('❌ Erreur génération prédiction:', error.message);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la génération de prédiction'
    });
  }
});

// GET /predictions/:sensorId/accuracy - Évaluer la précision des prédictions
router.get('/:sensorId/accuracy', async (req, res) => {
  try {
    const { sensorId } = req.params;
    const { hours = 24 } = req.query;

    const accuracy = await predictionService.evaluatePredictionAccuracy(
      sensorId, 
      parseInt(hours)
    );

    const stats = await Prediction.aggregate([
      {
        $match: {
          sensorId,
          createdAt: { $gte: new Date(Date.now() - parseInt(hours) * 60 * 60 * 1000) }
        }
      },
      {
        $group: {
          _id: null,
          totalPredictions: { $sum: 1 },
          avgConfidence: { $avg: '$confidence' },
          minConfidence: { $min: '$confidence' },
          maxConfidence: { $max: '$confidence' },
          avgHoursAhead: { $avg: '$hoursAhead' },
          maxHoursAhead: { $max: '$hoursAhead' },
          extremeCount: { $sum: { $cond: ['$isExtreme', 1, 0] } },
          actionRequiredCount: { $sum: { $cond: ['$requiresAction', 1, 0] } }
        }
      }
    ]);

    res.json({
      success: true,
      data: {
        accuracy: accuracy,
        statistics: stats[0] || {
          totalPredictions: 0,
          avgConfidence: 0,
          minConfidence: 0,
          maxConfidence: 0,
          avgHoursAhead: 0,
          maxHoursAhead: 0,
          extremeCount: 0,
          actionRequiredCount: 0
        }
      }
    });

  } catch (error) {
    console.error('❌ Erreur évaluation précision:', error.message);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de l\'évaluation de la précision'
    });
  }
});

// GET /predictions/:sensorId/weekly-summary - Résumé hebdomadaire
router.get('/:sensorId/weekly-summary', async (req, res) => {
  try {
    const { sensorId } = req.params;
    
    const summary = await Prediction.getWeeklySummary(sensorId);
    
    if (!summary) {
      return res.status(404).json({
        success: false,
        message: 'Aucune prédiction disponible pour ce capteur'
      });
    }
    
    res.json({
      success: true,
      ...summary
    });
    
  } catch (error) {
    console.error('❌ Erreur résumé hebdomadaire:', error.message);
    res.status(500).json({
      success: false,
      message: 'Erreur serveur'
    });
  }
});

// GET /predictions/:sensorId/by-quality/:level - Prédictions par niveau de qualité
router.get('/:sensorId/by-quality/:level', async (req, res) => {
  try {
    const { sensorId, level } = req.params;
    const { hours = 168 } = req.query;
    
    const predictions = await Prediction.getByQualityLevel(sensorId, level, parseInt(hours));
    
    res.json({
      success: true,
      sensorId,
      qualityLevel: level,
      count: predictions.length,
      predictions
    });
    
  } catch (error) {
    console.error('❌ Erreur prédictions par qualité:', error.message);
    res.status(500).json({
      success: false,
      message: 'Erreur serveur'
    });
  }
});

// GET /predictions/:sensorId/alerts - Alertes prédictives
router.get('/:sensorId/alerts', async (req, res) => {
  try {
    const { sensorId } = req.params;
    const { severity } = req.query;
    
    const predictions = await Prediction.getPredictiveAlerts(sensorId, severity || null);
    
    const alerts = [];
    predictions.forEach(pred => {
      if (pred.predictiveAlerts && pred.predictiveAlerts.length > 0) {
        pred.predictiveAlerts.forEach(alert => {
          alerts.push({
            ...alert,
            predictionFor: pred.predictionFor,
            hoursAhead: pred.hoursAhead,
            predictedPM25: pred.predictedPM25,
            confidence: pred.confidence
          });
        });
      }
    });
    
    res.json({
      success: true,
      sensorId,
      severity: severity || 'all',
      count: alerts.length,
      alerts
    });
    
  } catch (error) {
    console.error('❌ Erreur alertes prédictives:', error.message);
    res.status(500).json({
      success: false,
      message: 'Erreur serveur'
    });
  }
});

// GET /predictions/:sensorId/requires-action - Prédictions nécessitant action
router.get('/:sensorId/requires-action', async (req, res) => {
  try {
    const { sensorId } = req.params;
    const { hours = 168 } = req.query;
    
    const now = new Date();
    const futureTime = new Date(now.getTime() + parseInt(hours) * 60 * 60 * 1000);
    
    const predictions = await Prediction.find({
      sensorId,
      requiresAction: true,
      predictionFor: { $gte: now, $lte: futureTime }
    }).sort({ predictionFor: 1 });
    
    res.json({
      success: true,
      sensorId,
      count: predictions.length,
      predictions
    });
    
  } catch (error) {
    console.error('❌ Erreur prédictions action requise:', error.message);
    res.status(500).json({
      success: false,
      message: 'Erreur serveur'
    });
  }
});

// GET /predictions/:sensorId/recommendations - Recommandations pour une période
router.get('/:sensorId/recommendations', async (req, res) => {
  try {
    const { sensorId } = req.params;
    const { startDate, endDate, category, appliesTo } = req.query;
    
    const query = {
      sensorId,
      'recommendations.0': { $exists: true }
    };
    
    if (startDate && endDate) {
      query.predictionFor = {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      };
    }
    
    if (category) {
      query['recommendations.category'] = category;
    }
    
    const predictions = await Prediction.find(query).sort({ predictionFor: 1 });
    
    const allRecommendations = [];
    predictions.forEach(pred => {
      pred.recommendations.forEach(rec => {
        if (!appliesTo || rec.appliesTo.includes(appliesTo)) {
          allRecommendations.push({
            ...rec,
            predictionFor: pred.predictionFor,
            predictedPM25: pred.predictedPM25,
            qualityLevel: pred.predictedQuality?.level
          });
        }
      });
    });
    
    res.json({
      success: true,
      sensorId,
      count: allRecommendations.length,
      recommendations: allRecommendations
    });
    
  } catch (error) {
    console.error('❌ Erreur recommandations:', error.message);
    res.status(500).json({
      success: false,
      message: 'Erreur serveur'
    });
  }
});

// GET /predictions/:sensorId/dashboard - Dashboard complet
router.get('/:sensorId/dashboard', async (req, res) => {
  try {
    const { sensorId } = req.params;
    
    const summary = await Prediction.getWeeklySummary(sensorId);
    
    const now = new Date();
    const next24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    
    const urgentPredictions = await Prediction.find({
      sensorId,
      predictionFor: { $gte: now, $lte: next24h },
      requiresAction: true
    }).sort({ predictionFor: 1 });
    
    const accuracyStats = await Prediction.getAccuracyStats(sensorId, 7);
    
    const upcomingPeaks = await Prediction.find({
      sensorId,
      predictionFor: { $gte: now },
      isExtreme: true
    }).sort({ predictionFor: 1 }).limit(5);
    
    res.json({
      success: true,
      sensorId,
      timestamp: new Date(),
      summary,
      urgent: {
        count: urgentPredictions.length,
        predictions: urgentPredictions
      },
      accuracy: accuracyStats,
      upcoming_peaks: upcomingPeaks.map(p => ({
        time: p.predictionFor,
        hoursAhead: p.hoursAhead,
        pm25: p.predictedPM25,
        quality: p.predictedQuality?.level,
        confidence: p.confidence
      }))
    });
    
  } catch (error) {
    console.error('❌ Erreur dashboard:', error.message);
    res.status(500).json({
      success: false,
      message: 'Erreur serveur'
    });
  }
});

// ==================== FONCTION UTILITAIRE ====================

async function checkPredictionAlerts(sensorId, predictions) {
  try {
    if (!predictions || predictions.length === 0) return 0;

    let alertsCreated = 0;

    for (const prediction of predictions) {
      const pm25 = prediction.predictedPM25 || prediction.predicted_pm25;
      const confidence = prediction.confidence;
      const predictionFor = prediction.predictionFor || new Date(prediction.timestamp);
      
      if (pm25 > 50 && confidence > 0.7) {
        const hoursAhead = Math.round((new Date(predictionFor) - new Date()) / (60 * 60 * 1000));
        
        let severity;
        if (pm25 > 150) {
          severity = 'hazardous';
        } else if (pm25 > 100) {
          severity = 'unhealthy';
        } else if (pm25 > 75) {
          severity = 'poor';
        } else {
          severity = 'moderate';
        }
        
        const alertData = {
          sensorId,
          alertType: 'prediction_warning',
          severity: severity,
          qualityLevel: severity,
          referenceStandard: 'PREDICTED',
          message: `🔮 Alerte prédictive: PM2.5 prévu à ${pm25.toFixed(1)} µg/m³ dans ${hoursAhead}h`,
          data: {
            predictedValue: pm25,
            predictedAQI: prediction.predictedAQI || prediction.predicted_aqi,
            confidence: confidence,
            predictionFor: predictionFor,
            hoursAhead: hoursAhead,
            qualityLevel: prediction.predictedQuality?.level || severity,
            uncertaintyLevel: prediction.uncertainty?.level || 'medium',
            contributingFactors: prediction.factors?.contributing_factors || []
          }
        };

        const Alert = require('../models/Alert');
        const existingAlert = await Alert.findOne({
          sensorId,
          alertType: 'prediction_warning',
          isActive: true,
          'data.predictionFor': predictionFor
        });

        if (!existingAlert) {
          const savedAlert = await alertService.saveAlert(alertData);
          if (savedAlert) {
            triggerAlert(savedAlert);
            alertsCreated++;
          }
        }
      }
    }

    return alertsCreated;

  } catch (error) {
    console.error('❌ Erreur vérification alertes prédictives:', error.message);
    return 0;
  }
}

module.exports = router;
