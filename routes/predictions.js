// routes/predictions.js - Routes pour les prédictions IA
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

// GET /predictions/sensors - Liste des capteurs avec prédictions disponibles
router.get('/sensors', async (req, res) => {
  try {
    const sensorsWithPredictions = await Prediction.aggregate([
      {
        $match: {
          predictionFor: { $gt: new Date() } // Prédictions futures uniquement
        }
      },
      {
        $group: {
          _id: '$sensorId',
          latestPrediction: { $max: '$predictionFor' },
          predictionsCount: { $sum: 1 },
          avgConfidence: { $avg: '$confidence' },
          modelVersion: { $last: '$modelVersion' }
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

// GET /predictions/:sensorId - Obtenir les prédictions d'un capteur
router.get('/:sensorId', async (req, res) => {
  try {
    const { sensorId } = req.params;
    const { type = 'future', limit = 24 } = req.query;

    let predictions;
    
    if (type === 'future') {
      predictions = await predictionService.getFuturePredictions(sensorId);
    } else if (type === 'recent') {
      predictions = await predictionService.getRecentPredictions(sensorId, parseInt(limit));
    } else {
      // Toutes les prédictions
      predictions = await Prediction
        .find({ sensorId })
        .sort({ predictionFor: type === 'asc' ? 1 : -1 })
        .limit(parseInt(limit));
    }

    // Évaluer la précision des prédictions récentes
    const accuracy = await predictionService.evaluatePredictionAccuracy(sensorId, 24);

    res.json({
      success: true,
      data: predictions,
      accuracy: accuracy,
      count: predictions.length
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
    const { hoursAhead = 1 } = req.body;

    // Validation
    if (hoursAhead < 1 || hoursAhead > 72) {
      return res.status(400).json({
        success: false,
        message: 'hoursAhead doit être entre 1 et 72 heures'
      });
    }

    const result = await predictionService.generatePrediction(sensorId, hoursAhead);

    if (result.success) {
      // Vérifier si les prédictions indiquent un risque élevé
      await checkPredictionAlerts(sensorId, result.predictions);
    }

    res.status(result.success ? 201 : 400).json(result);

  } catch (error) {
    console.error('❌ Erreur génération prédiction:', error.message);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la génération de prédiction'
    });
  }
});

// POST /predictions/batch/generate - Générer des prédictions pour tous les capteurs
router.post('/batch/generate', authService.requireAdmin.bind(authService), async (req, res) => {
  try {
    const { hoursAhead = 6 } = req.body;

    // Récupérer la liste des capteurs actifs
    const SensorData = require('../models/SensorData');
    const activeSensors = await SensorData.distinct('sensorId', {
      timestamp: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
    });

    const results = [];
    let successCount = 0;
    let errorCount = 0;

    for (const sensorId of activeSensors) {
      try {
        const result = await predictionService.generatePrediction(sensorId, hoursAhead);
        
        if (result.success) {
          successCount++;
          // Vérifier les alertes pour chaque capteur
          await checkPredictionAlerts(sensorId, result.predictions);
        } else {
          errorCount++;
        }

        results.push({
          sensorId,
          success: result.success,
          message: result.message,
          predictionsCount: result.predictions ? result.predictions.length : 0
        });

        // Délai pour éviter la surcharge
        await new Promise(resolve => setTimeout(resolve, 1000));

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
        errors: errorCount
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

// GET /predictions/:sensorId/accuracy - Évaluer la précision des prédictions
router.get('/:sensorId/accuracy', async (req, res) => {
  try {
    const { sensorId } = req.params;
    const { hours = 24 } = req.query;

    const accuracy = await predictionService.evaluatePredictionAccuracy(
      sensorId, 
      parseInt(hours)
    );

    // Statistiques détaillées
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
          modelVersions: { $addToSet: '$modelVersion' }
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
          modelVersions: []
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

// GET /predictions/stats/global - Statistiques globales des prédictions
router.get('/stats/global', async (req, res) => {
  try {
    const { period = '24h' } = req.query;

    // Calculer la période
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

    // Statistiques globales
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
          maxPredictedAQI: { $max: '$predictedAQI' }
        }
      }
    ]);

    // Par capteur
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
          lastPrediction: { $max: '$predictionFor' }
        }
      },
      {
        $sort: { predictions: -1 }
      }
    ]);

    // Évolution temporelle
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
          avgPredictedPM25: { $avg: '$predictedPM25' }
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

// DELETE /predictions/cleanup - Nettoyer les anciennes prédictions (admin seulement)
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

// POST /predictions/test - Tester le service de prédiction (développement)
if (process.env.NODE_ENV === 'development') {
  router.post('/test', authService.requireAdmin.bind(authService), async (req, res) => {
    try {
      const { sensorId = 'TEST_SENSOR_001' } = req.body;

      // Test avec données simulées
      const result = await predictionService.generatePrediction(sensorId, 3);

      res.json({
        success: true,
        message: 'Test de prédiction effectué',
        testSensorId: sensorId,
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

// Fonction utilitaire pour vérifier les alertes basées sur les prédictions
async function checkPredictionAlerts(sensorId, predictions) {
  try {
    if (!predictions || predictions.length === 0) return;

    for (const prediction of predictions) {
      // Seuil d'alerte prédictive (PM2.5 > 50 avec confiance > 0.7)
      if (prediction.predictedPM25 > 50 && prediction.confidence > 0.7) {
        const alertData = {
          sensorId,
          alertType: 'prediction_warning',
          severity: prediction.predictedPM25 > 100 ? 'high' : 'medium',
          message: `🔮 Alerte prédictive: PM2.5 prévu à ${prediction.predictedPM25.toFixed(1)} µg/m³ dans ${Math.round((new Date(prediction.predictionFor) - new Date()) / (60 * 60 * 1000))}h`,
          data: {
            predictedValue: prediction.predictedPM25,
            predictedAQI: prediction.predictedAQI,
            confidence: prediction.confidence,
            predictionFor: prediction.predictionFor,
            hoursAhead: Math.round((new Date(prediction.predictionFor) - new Date()) / (60 * 60 * 1000))
          }
        };

        // Vérifier si une alerte similaire existe déjà
        const existingAlert = await require('../models/Alert').findOne({
          sensorId,
          alertType: 'prediction_warning',
          isActive: true,
          'data.predictionFor': prediction.predictionFor
        });

        if (!existingAlert) {
          const savedAlert = await alertService.saveAlert(alertData);
          if (savedAlert) {
            triggerAlert(savedAlert);
          }
        }
      }
    }

  } catch (error) {
    console.error('❌ Erreur vérification alertes prédictives:', error.message);
  }
}

module.exports = router;