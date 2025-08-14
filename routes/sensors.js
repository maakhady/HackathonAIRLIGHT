// routes/sensors.js - Routes pour les données des capteurs (CORRIGÉ)
const express = require('express');
const AirGradientService = require('../services/AirGradientService');
const AlertService = require('../services/AlertService');
const AuthService = require('../services/AuthService');
const SensorData = require('../models/SensorData');
const { triggerAlert } = require('../middleware/alertMiddleware');

const router = express.Router();

// CORRECTION: Instanciation correcte des services avec 'new'
const airGradientService = new AirGradientService();
const alertService = new AlertService();
const authService = new AuthService();

// GET /sensors - Obtenir la liste des capteurs disponibles
router.get('/', async (req, res) => {
  try {
    // CORRECTION: Utiliser getSensorLocations() au lieu de getSensorLocations
    const sensors = await airGradientService.getSensorLocations();
    
    // Obtenir les dernières données pour chaque capteur
    const sensorsWithData = await Promise.all(
      sensors.map(async (sensor) => {
        const latestData = await SensorData
          .findOne({ sensorId: sensor.id })
          .sort({ timestamp: -1 });
        
        return {
          ...sensor,
          lastUpdate: latestData?.timestamp,
          status: latestData ? 'active' : 'inactive',
          qualityLevel: latestData?.qualityLevel,
          airQualityIndex: latestData?.airQualityIndex
        };
      })
    );
    
    res.json({
      success: true,
      data: sensorsWithData,
      count: sensorsWithData.length
    });
    
  } catch (error) {
    console.error('❌ Erreur récupération capteurs:', error.message);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération des capteurs'
    });
  }
});
// GET /sensors/:sensorId/data - Version AMÉLIORÉE avec toutes les heures possibles
router.get('/:sensorId/data', async (req, res) => {
  try {
    const { sensorId } = req.params;
    const { 
      period = '24h', 
      limit = 100, 
      offset = 0,
      parameter, // pm25, pm10, co2, etc.
      // ✅ NOUVEAUX PARAMÈTRES pour plus de flexibilité
      startDate, // Date de début custom (ISO string)
      endDate,   // Date de fin custom (ISO string)
      hours,     // Nombre d'heures depuis maintenant
      days,      // Nombre de jours depuis maintenant
      minutes    // Nombre de minutes depuis maintenant
    } = req.query;
    
    // ✅ FONCTION: Calculer la période avec toutes les options possibles
    let calculatedStartDate;
    let calculatedEndDate = new Date(); // Par défaut = maintenant
    
    // 1️⃣ Si dates personnalisées fournies (priorité max)
    if (startDate && endDate) {
      calculatedStartDate = new Date(startDate);
      calculatedEndDate = new Date(endDate);
      
      if (isNaN(calculatedStartDate.getTime()) || isNaN(calculatedEndDate.getTime())) {
        return res.status(400).json({
          success: false,
          message: 'Format de date invalide. Utilisez le format ISO: 2024-01-15T10:30:00Z'
        });
      }
      
    // 2️⃣ Si seulement startDate fourni
    } else if (startDate) {
      calculatedStartDate = new Date(startDate);
      if (isNaN(calculatedStartDate.getTime())) {
        return res.status(400).json({
          success: false,
          message: 'Format de startDate invalide'
        });
      }
      
    // 3️⃣ Si paramètre 'hours' fourni (NOUVEAU)
    } else if (hours) {
      const hoursNum = parseFloat(hours);
      if (hoursNum <= 0 || hoursNum > 8760) { // Max 1 an
        return res.status(400).json({
          success: false,
          message: 'Le paramètre hours doit être entre 0.1 et 8760 (1 an)'
        });
      }
      calculatedStartDate = new Date(Date.now() - hoursNum * 60 * 60 * 1000);
      
    // 4️⃣ Si paramètre 'days' fourni (NOUVEAU)
    } else if (days) {
      const daysNum = parseFloat(days);
      if (daysNum <= 0 || daysNum > 365) { // Max 1 an
        return res.status(400).json({
          success: false,
          message: 'Le paramètre days doit être entre 0.1 et 365'
        });
      }
      calculatedStartDate = new Date(Date.now() - daysNum * 24 * 60 * 60 * 1000);
      
    // 5️⃣ Si paramètre 'minutes' fourni (NOUVEAU)
    } else if (minutes) {
      const minutesNum = parseFloat(minutes);
      if (minutesNum <= 0 || minutesNum > 525600) { // Max 1 an en minutes
        return res.status(400).json({
          success: false,
          message: 'Le paramètre minutes doit être entre 1 et 525600 (1 an)'
        });
      }
      calculatedStartDate = new Date(Date.now() - minutesNum * 60 * 1000);
      
    // 6️⃣ Sinon, utiliser les périodes prédéfinies (ÉTENDU)
    } else {
      switch (period) {
        // ✅ MINUTES
        case '15min':
        case '15m':
          calculatedStartDate = new Date(Date.now() - 15 * 60 * 1000);
          break;
        case '30min':
        case '30m':
          calculatedStartDate = new Date(Date.now() - 30 * 60 * 1000);
          break;
        case '45min':
        case '45m':
          calculatedStartDate = new Date(Date.now() - 45 * 60 * 1000);
          break;
          
        // ✅ HEURES (toutes les heures de 1 à 72)
        case '1h':
          calculatedStartDate = new Date(Date.now() - 1 * 60 * 60 * 1000);
          break;
        case '2h':
          calculatedStartDate = new Date(Date.now() - 2 * 60 * 60 * 1000);
          break;
        case '3h':
          calculatedStartDate = new Date(Date.now() - 3 * 60 * 60 * 1000);
          break;
        case '4h':
          calculatedStartDate = new Date(Date.now() - 4 * 60 * 60 * 1000);
          break;
        case '6h':
          calculatedStartDate = new Date(Date.now() - 6 * 60 * 60 * 1000);
          break;
        case '8h':
          calculatedStartDate = new Date(Date.now() - 8 * 60 * 60 * 1000);
          break;
        case '12h':
          calculatedStartDate = new Date(Date.now() - 12 * 60 * 60 * 1000);
          break;
        case '18h':
          calculatedStartDate = new Date(Date.now() - 18 * 60 * 60 * 1000);
          break;
        case '24h':
        case '1d':
          calculatedStartDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
          break;
        case '48h':
        case '2d':
          calculatedStartDate = new Date(Date.now() - 48 * 60 * 60 * 1000);
          break;
        case '72h':
        case '3d':
          calculatedStartDate = new Date(Date.now() - 72 * 60 * 60 * 1000);
          break;
          
        // ✅ JOURS
        case '7d':
        case '1w':
          calculatedStartDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
          break;
        case '14d':
        case '2w':
          calculatedStartDate = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
          break;
        case '30d':
        case '1m':
          calculatedStartDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
          break;
        case '90d':
        case '3m':
          calculatedStartDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
          break;
        case '180d':
        case '6m':
          calculatedStartDate = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000);
          break;
        case '365d':
        case '1y':
          calculatedStartDate = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
          break;
          
        // ✅ SUPPORT HEURES PERSONNALISÉES (ex: "5h", "25h", "100h")
        default:
          // Vérifier si c'est un format comme "5h", "25h", "100h"
          const hourMatch = period.match(/^(\d+\.?\d*)h$/);
          const dayMatch = period.match(/^(\d+\.?\d*)d$/);
          const minuteMatch = period.match(/^(\d+\.?\d*)m$/);
          
          if (hourMatch) {
            const hoursValue = parseFloat(hourMatch[1]);
            if (hoursValue > 0 && hoursValue <= 8760) {
              calculatedStartDate = new Date(Date.now() - hoursValue * 60 * 60 * 1000);
            } else {
              return res.status(400).json({
                success: false,
                message: 'Période en heures invalide. Max: 8760h (1 an)'
              });
            }
          } else if (dayMatch) {
            const daysValue = parseFloat(dayMatch[1]);
            if (daysValue > 0 && daysValue <= 365) {
              calculatedStartDate = new Date(Date.now() - daysValue * 24 * 60 * 60 * 1000);
            } else {
              return res.status(400).json({
                success: false,
                message: 'Période en jours invalide. Max: 365d'
              });
            }
          } else if (minuteMatch) {
            const minutesValue = parseFloat(minuteMatch[1]);
            if (minutesValue > 0 && minutesValue <= 525600) {
              calculatedStartDate = new Date(Date.now() - minutesValue * 60 * 1000);
            } else {
              return res.status(400).json({
                success: false,
                message: 'Période en minutes invalide. Max: 525600m'
              });
            }
          } else {
            // Fallback vers 24h si période non reconnue
            calculatedStartDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
          }
      }
    }
    
    // ✅ Construire le filtre avec les dates calculées
    const filter = { 
      sensorId, 
      timestamp: { 
        $gte: calculatedStartDate,
        $lte: calculatedEndDate
      }
    };
    
    // ✅ Si endDate fourni, l'utiliser
    if (endDate && !startDate) {
      filter.timestamp.$lte = new Date(endDate);
    }
    
    // ✅ Requête avec sélection optionnelle de paramètre
    const selectFields = parameter ? 
      `sensorId measurements.${parameter} timestamp airQualityIndex qualityLevel location source` : 
      '';
    
    const data = await SensorData
      .find(filter)
      .sort({ timestamp: -1 })
      .limit(parseInt(limit))
      .skip(parseInt(offset))
      .select(selectFields);
    
    const totalCount = await SensorData.countDocuments(filter);
    
    // ✅ Statistiques pour la période
    const stats = await SensorData.aggregate([
      { $match: filter },
      {
        $group: {
          _id: null,
          count: { $sum: 1 },
          avgPM25: { $avg: '$measurements.pm25' },
          maxPM25: { $max: '$measurements.pm25' },
          minPM25: { $min: '$measurements.pm25' },
          avgPM10: { $avg: '$measurements.pm10' },
          maxPM10: { $max: '$measurements.pm10' },
          minPM10: { $min: '$measurements.pm10' },
          avgCO2: { $avg: '$measurements.co2' },
          maxCO2: { $max: '$measurements.co2' },
          minCO2: { $min: '$measurements.co2' },
          avgAQI: { $avg: '$airQualityIndex' },
          maxAQI: { $max: '$airQualityIndex' },
          minAQI: { $min: '$airQualityIndex' },
          firstTimestamp: { $min: '$timestamp' },
          lastTimestamp: { $max: '$timestamp' }
        }
      }
    ]);
    
    // ✅ Calculer la durée réelle des données
    const actualTimespan = stats[0] ? {
      from: stats[0].firstTimestamp,
      to: stats[0].lastTimestamp,
      durationHours: Math.round((stats[0].lastTimestamp - stats[0].firstTimestamp) / (60 * 60 * 1000) * 100) / 100,
      durationDays: Math.round((stats[0].lastTimestamp - stats[0].firstTimestamp) / (24 * 60 * 60 * 1000) * 100) / 100
    } : null;
    
    res.json({
      success: true,
      data,
      stats: stats[0] || {},
      timespan: {
        requested: {
          from: calculatedStartDate,
          to: calculatedEndDate,
          period: period
        },
        actual: actualTimespan
      },
      pagination: {
        total: totalCount,
        limit: parseInt(limit),
        offset: parseInt(offset),
        hasMore: totalCount > parseInt(offset) + parseInt(limit)
      },
      // ✅ INFORMATIONS DE DEBUG
      query: {
        period: period,
        hours: hours,
        days: days,
        minutes: minutes,
        startDate: startDate,
        endDate: endDate,
        parameter: parameter
      }
    });
    
  } catch (error) {
    console.error('❌ Erreur récupération données capteur:', error.message);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération des données',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// GET /sensors/:sensorId/latest - Dernière mesure d'un capteur
router.get('/:sensorId/latest', async (req, res) => {
  try {
    const { sensorId } = req.params;
    
    const latestData = await SensorData
      .findOne({ sensorId })
      .sort({ timestamp: -1 });
    
    if (!latestData) {
      return res.status(404).json({
        success: false,
        message: 'Aucune donnée trouvée pour ce capteur'
      });
    }
    
    res.json({
      success: true,
      data: latestData
    });
    
  } catch (error) {
    console.error('❌ Erreur dernières données:', error.message);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération des dernières données'
    });
  }
});

// POST /sensors/data - Recevoir des données depuis un capteur ESP32
router.post('/data', async (req, res) => {
  try {
    const sensorData = req.body;
    
    // Validation des données requises
    if (!sensorData.sensorId || !sensorData.measurements) {
      return res.status(400).json({
        success: false,
        message: 'Données de capteur invalides - sensorId et measurements requis'
      });
    }
    
    // Créer l'enregistrement
    const newSensorData = new SensorData({
      sensorId: sensorData.sensorId,
      location: sensorData.location || {},
      measurements: sensorData.measurements,
      timestamp: sensorData.timestamp ? new Date(sensorData.timestamp) : new Date(),
      source: sensorData.source || 'esp32'
    });
    
    await newSensorData.save();
    
    // Vérifier et créer des alertes si nécessaire
    const alerts = await alertService.checkAndCreateAlerts(sensorData);
    
    // Diffuser les nouvelles alertes via WebSocket
    if (alerts && alerts.length > 0) {
      alerts.forEach(alert => {
        if (alert && alert._id) {
          triggerAlert(alert);
        }
      });
    }
    
    res.status(201).json({
      success: true,
      message: 'Données sauvegardées',
      data: newSensorData,
      alertsGenerated: alerts ? alerts.length : 0
    });
    
  } catch (error) {
    console.error('❌ Erreur sauvegarde données capteur:', error.message);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la sauvegarde des données'
    });
  }
});

// POST /sensors/sync - Synchroniser avec l'API AirGradient (admin seulement)
router.post('/sync', authService.requireAdmin.bind(authService), async (req, res) => {
  try {
    console.log('🔄 Début de la synchronisation AirGradient...');
    
    const allSensorsData = await airGradientService.fetchAllSensorsData();
    let savedCount = 0;
    let errorCount = 0;
    
    for (const { location, data } of allSensorsData) {
      try {
        const transformedData = airGradientService.transformDataForStorage(data, location);
        
        for (const sensorReading of transformedData) {
          // Vérifier si cette donnée existe déjà
          const existingData = await SensorData.findOne({
            sensorId: sensorReading.sensorId,
            timestamp: {
              $gte: new Date(sensorReading.timestamp.getTime() - 5 * 60 * 1000),
              $lte: new Date(sensorReading.timestamp.getTime() + 5 * 60 * 1000)
            }
          });
          
          if (!existingData) {
            const newData = new SensorData(sensorReading);
            await newData.save();
            savedCount++;
            
            // Vérifier les alertes pour les nouvelles données
            const alerts = await alertService.checkAndCreateAlerts({
              sensorId: sensorReading.sensorId,
              measurements: sensorReading.measurements,
              location: sensorReading.location
            });
            
            // Diffuser les alertes
            if (alerts && alerts.length > 0) {
              alerts.forEach(alert => {
                if (alert && alert._id) {
                  triggerAlert(alert);
                }
              });
            }
          }
        }
        
      } catch (error) {
        console.error(`❌ Erreur traitement ${location.name}:`, error.message);
        errorCount++;
      }
    }
    
    console.log(`✅ Synchronisation terminée: ${savedCount} enregistrements sauvés, ${errorCount} erreurs`);
    
    res.json({
      success: true,
      message: 'Synchronisation terminée',
      results: {
        sensorsProcessed: allSensorsData.length,
        recordsSaved: savedCount,
        errors: errorCount
      }
    });
    
  } catch (error) {
    console.error('❌ Erreur synchronisation:', error.message);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la synchronisation'
    });
  }
});

// GET /sensors/stats/global - Statistiques globales de tous les capteurs
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
    const globalStats = await SensorData.aggregate([
      {
        $match: {
          timestamp: { $gte: startDate }
        }
      },
      {
        $group: {
          _id: null,
          totalMeasurements: { $sum: 1 },
          avgPM25: { $avg: '$measurements.pm25' },
          maxPM25: { $max: '$measurements.pm25' },
          avgPM10: { $avg: '$measurements.pm10' },
          maxPM10: { $max: '$measurements.pm10' },
          avgCO2: { $avg: '$measurements.co2' },
          maxCO2: { $max: '$measurements.co2' },
          avgAQI: { $avg: '$airQualityIndex' },
          goodQuality: { $sum: { $cond: [{ $eq: ['$qualityLevel', 'good'] }, 1, 0] } },
          moderateQuality: { $sum: { $cond: [{ $eq: ['$qualityLevel', 'moderate'] }, 1, 0] } },
          poorQuality: { $sum: { $cond: [{ $eq: ['$qualityLevel', 'poor'] }, 1, 0] } },
          veryPoorQuality: { $sum: { $cond: [{ $eq: ['$qualityLevel', 'very_poor'] }, 1, 0] } }
        }
      }
    ]);
    
    // Statistiques par capteur
    const sensorStats = await SensorData.aggregate([
      {
        $match: {
          timestamp: { $gte: startDate }
        }
      },
      {
        $group: {
          _id: '$sensorId',
          location: { $first: '$location.name' },
          city: { $first: '$location.city' },
          measurements: { $sum: 1 },
          lastUpdate: { $max: '$timestamp' },
          avgPM25: { $avg: '$measurements.pm25' },
          avgAQI: { $avg: '$airQualityIndex' },
          currentQuality: { $last: '$qualityLevel' }
        }
      },
      {
        $sort: { avgAQI: -1 }
      }
    ]);
    
    // Évolution temporelle (par heure pour 24h, par jour pour plus long)
    const timeGrouping = period === '24h' ? {
      year: { $year: '$timestamp' },
      month: { $month: '$timestamp' },
      day: { $dayOfMonth: '$timestamp' },
      hour: { $hour: '$timestamp' }
    } : {
      year: { $year: '$timestamp' },
      month: { $month: '$timestamp' },
      day: { $dayOfMonth: '$timestamp' }
    };
    
    const timeEvolution = await SensorData.aggregate([
      {
        $match: {
          timestamp: { $gte: startDate }
        }
      },
      {
        $group: {
          _id: timeGrouping,
          avgPM25: { $avg: '$measurements.pm25' },
          avgPM10: { $avg: '$measurements.pm10' },
          avgCO2: { $avg: '$measurements.co2' },
          avgAQI: { $avg: '$airQualityIndex' },
          timestamp: { $first: '$timestamp' }
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
        bySensor: sensorStats,
        timeEvolution
      }
    });
    
  } catch (error) {
    console.error('❌ Erreur stats globales:', error.message);
    res.status(500).json({
      success: false,
      message: 'Erreur lors du calcul des statistiques globales'
    });
  }
});

// GET /sensors/:sensorId/alerts - Alertes spécifiques à un capteur
router.get('/:sensorId/alerts', authService.authenticateToken.bind(authService), async (req, res) => {
  try {
    const { sensorId } = req.params;
    const { active = true, limit = 50 } = req.query;
    
    const Alert = require('../models/Alert');
    
    const filter = { sensorId };
    if (active === 'true') {
      filter.isActive = true;
    }
    
    const alerts = await Alert
      .find(filter)
      .sort({ createdAt: -1 })
      .limit(parseInt(limit));
    
    res.json({
      success: true,
      data: alerts,
      count: alerts.length
    });
    
  } catch (error) {
    console.error('❌ Erreur alertes capteur:', error.message);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération des alertes'
    });
  }
});

// DELETE /sensors/data/cleanup - Nettoyer les anciennes données (admin seulement)
router.delete('/data/cleanup', authService.requireAdmin.bind(authService), async (req, res) => {
  try {
    const { daysOld = 90 } = req.query;
    const cutoffDate = new Date(Date.now() - parseInt(daysOld) * 24 * 60 * 60 * 1000);
    
    const result = await SensorData.deleteMany({
      timestamp: { $lt: cutoffDate }
    });
    
    res.json({
      success: true,
      message: `${result.deletedCount} anciens enregistrements supprimés`,
      deletedCount: result.deletedCount,
      cutoffDate
    });
    
  } catch (error) {
    console.error('❌ Erreur nettoyage données:', error.message);
    res.status(500).json({
      success: false,
      message: 'Erreur lors du nettoyage des données'
    });
  }
});

// Route de test pour vérifier le service AirGradient
router.get('/test-airgradient', async (req, res) => {
  try {
    const connectionTest = await airGradientService.testAPIConnection();
    const accountStats = await airGradientService.getAccountStats();
    
    res.json({
      success: true,
      message: 'Test du service AirGradient',
      connection: connectionTest,
      stats: accountStats,
      token_configured: !!process.env.AIRGRADIENT_TOKEN
    });
    
  } catch (error) {
    console.error('❌ Erreur test AirGradient:', error.message);
    res.status(500).json({
      success: false,
      message: 'Erreur lors du test AirGradient',
      error: error.message
    });
  }
});

module.exports = router;