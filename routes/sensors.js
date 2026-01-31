// routes/sensors.js - Routes pour les données des capteurs (CORRIGÉ - ORDRE DES ROUTES FIXÉ)
const express = require('express');
const AirGradientService = require('../services/AirGradientService');
const AlertService = require('../services/AlertService');
const AuthService = require('../services/AuthService');
const SensorData = require('../models/SensorData');
const Alert = require('../models/Alert'); // ✅ Import global
const { triggerAlert } = require('../middleware/alertMiddleware');
const WeatherService = require('../services/WeatherService');

const router = express.Router();

// Instanciation correcte des services avec 'new'
const airGradientService = new AirGradientService();
const alertService = new AlertService();
const authService = new AuthService();

// =====================================================
// ROUTES STATIQUES (DOIVENT ÊTRE EN PREMIER)
// =====================================================

// GET /sensors - Obtenir la liste des capteurs disponibles
router.get('/', async (req, res) => {
  try {
    console.log('📡 GET /sensors - Récupération liste des capteurs');
    
    // Récupérer les données en temps réel d'AirGradient
    const airgradientData = await airGradientService.fetchAllSensorsData();
    
    if (!airgradientData || airgradientData.length === 0) {
      console.warn('⚠️ Aucune donnée AirGradient disponible');
      return res.json({
        success: true,
        data: [],
        message: 'Aucun capteur disponible',
        stats: {
          total: 0,
          online: 0,
          offline: 0
        }
      });
    }
    
    // ✅ TRANSFORMATION CORRIGÉE pour le format Angular
    const sensors = airgradientData.map(sensor => ({
      // Identifiants
      id: sensor.location.id,
      name: sensor.location.name,
      
      // Localisation
      city: sensor.location.city,
      country: sensor.location.country,
      
      // Coordonnées GPS (les deux formats pour compatibilité)
      latitude: sensor.location.coordinates?.lat,
      longitude: sensor.location.coordinates?.lng,
      coordinates: sensor.location.coordinates,
      
      // Statut en ligne/hors ligne
      status: sensor.status, // 'online' ou 'offline'
      isOnline: sensor.status === 'online',
      
      // Dernières données
      lastUpdate: sensor.data && sensor.data.length > 0 
        ? sensor.data[0].timestamp 
        : null,
      
      // AQI si disponible
      airQualityIndex: sensor.data && sensor.data.length > 0
        ? calculateAQIFromData(sensor.data[0])
        : null
    }));
    
    const onlineCount = sensors.filter(s => s.status === 'online').length;
    const offlineCount = sensors.filter(s => s.status === 'offline').length;
    
    console.log(`✅ Réponse: ${onlineCount} en ligne, ${offlineCount} hors ligne (${sensors.length} total)`);
    
    res.json({
      success: true,
      data: sensors,
      count: sensors.length,
      stats: {
        total: sensors.length,
        online: onlineCount,
        offline: offlineCount
      }
    });
    
  } catch (error) {
    console.error('❌ Erreur récupération capteurs:', error.message);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération des capteurs',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
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

// GET /sensors/test-airgradient - Test du service AirGradient
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

// 🌤️ GET /sensors/weather/dashboard - Tableau de bord météo tous capteurs
// ✅ DÉPLACÉ ICI - AVANT la route dynamique /:sensorId/weather
router.get('/weather/dashboard', async (req, res) => {
  try {
    const weatherService = new WeatherService();
    
    // Récupérer météo pour toutes les villes
    const allWeatherData = await weatherService.getWeatherForAllSensorCities();
    
    if (!allWeatherData.success) {
      return res.status(400).json(allWeatherData);
    }
    
    // Enrichir avec données capteurs
    const enrichedData = [];
    
    for (const cityWeather of allWeatherData.data) {
      if (cityWeather.success) {
        // Trouver capteurs dans cette ville
        const citySensors = await SensorData.aggregate([
          {
            $match: {
              'location.city': cityWeather.city,
              timestamp: { $gte: new Date(Date.now() - 6 * 60 * 60 * 1000) } // 6h
            }
          },
          {
            $group: {
              _id: '$sensorId',
              lastUpdate: { $max: '$timestamp' },
              avgPM25: { $avg: '$measurements.pm25' },
              avgAQI: { $avg: '$airQualityIndex' },
              location: { $first: '$location' }
            }
          }
        ]);
        
        enrichedData.push({
          city: cityWeather.city,
          weather: cityWeather.data,
          air_quality_impact: weatherService.analyzeAirQualityImpact(cityWeather.data),
          sensors: citySensors,
          correlation_summary: analyzeCityWeatherCorrelation(cityWeather.data, citySensors)
        });
      }
    }
    
    // Calculer alertes météo globales
    const globalAlerts = await Alert.find({
      alertType: { $in: ['weather_air_quality', 'weather_forecast_warning'] },
      isActive: true,
      createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
    }).sort({ createdAt: -1 });
    
    const dashboard = {
      timestamp: new Date(),
      cities_data: enrichedData,
      global_weather_alerts: globalAlerts,
      summary: {
        cities_monitored: enrichedData.length,
        sensors_active: enrichedData.reduce((sum, city) => sum + city.sensors.length, 0),
        weather_alerts_active: globalAlerts.length,
        worst_air_quality_impact: getWorstAirQualityImpact(enrichedData)
      }
    };
    
    res.json({
      success: true,
      data: dashboard,
      message: 'Tableau de bord météo/capteurs mis à jour'
    });
    
  } catch (error) {
    console.error('❌ Erreur dashboard météo capteurs:', error.message);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la génération du dashboard'
    });
  }
});

// =====================================================
// ROUTES POST/PUT/DELETE (SANS PARAMÈTRES DYNAMIQUES)
// =====================================================

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

// =====================================================
// ROUTES DYNAMIQUES (AVEC :sensorId, :alertId, etc.)
// =====================================================

// GET /sensors/:sensorId/data - Version AMÉLIORÉE avec toutes les heures possibles
router.get('/:sensorId/data', async (req, res) => {
  try {
    const { sensorId } = req.params;
    const { 
      period = '24h', 
      limit = 100, 
      offset = 0,
      parameter, // pm25, pm10, co2, etc.
      startDate, // Date de début custom (ISO string)
      endDate,   // Date de fin custom (ISO string)
      hours,     // Nombre d'heures depuis maintenant
      days,      // Nombre de jours depuis maintenant
      minutes    // Nombre de minutes depuis maintenant
    } = req.query;
    
    // Calculer la période avec toutes les options possibles
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
      
    // 3️⃣ Si paramètre 'hours' fourni
    } else if (hours) {
      const hoursNum = parseFloat(hours);
      if (hoursNum <= 0 || hoursNum > 8760) {
        return res.status(400).json({
          success: false,
          message: 'Le paramètre hours doit être entre 0.1 et 8760 (1 an)'
        });
      }
      calculatedStartDate = new Date(Date.now() - hoursNum * 60 * 60 * 1000);
      
    // 4️⃣ Si paramètre 'days' fourni
    } else if (days) {
      const daysNum = parseFloat(days);
      if (daysNum <= 0 || daysNum > 365) {
        return res.status(400).json({
          success: false,
          message: 'Le paramètre days doit être entre 0.1 et 365'
        });
      }
      calculatedStartDate = new Date(Date.now() - daysNum * 24 * 60 * 60 * 1000);
      
    // 5️⃣ Si paramètre 'minutes' fourni
    } else if (minutes) {
      const minutesNum = parseFloat(minutes);
      if (minutesNum <= 0 || minutesNum > 525600) {
        return res.status(400).json({
          success: false,
          message: 'Le paramètre minutes doit être entre 1 et 525600 (1 an)'
        });
      }
      calculatedStartDate = new Date(Date.now() - minutesNum * 60 * 1000);
      
    // 6️⃣ Sinon, utiliser les périodes prédéfinies
    } else {
      switch (period) {
        // Minutes
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
          
        // Heures
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
        case '168h':
          calculatedStartDate = new Date(Date.now() - 168 * 60 * 60 * 1000);
          break;
          
        // Jours
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
          
        // Support heures personnalisées (ex: "5h", "25h", "100h")
        default:
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
            // Fallback vers 24h
            calculatedStartDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
          }
      }
    }
    
    // Construire le filtre
    const filter = { 
      sensorId, 
      timestamp: { 
        $gte: calculatedStartDate,
        $lte: calculatedEndDate
      }
    };
    
    // Si endDate fourni, l'utiliser
    if (endDate && !startDate) {
      filter.timestamp.$lte = new Date(endDate);
    }
    
    // Requête avec sélection optionnelle
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
    
    // Statistiques
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
    
    // Calculer durée réelle
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

// GET /sensors/:sensorId/alerts - Alertes spécifiques à un capteur
router.get('/:sensorId/alerts', authService.authenticateToken.bind(authService), async (req, res) => {
  try {
    const { sensorId } = req.params;
    const { active = true, limit = 50 } = req.query;
    
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

// GET /sensors/:sensorId/weather - Météo pour un capteur spécifique
// ✅ MAINTENANT APRÈS /weather/dashboard
router.get('/:sensorId/weather', async (req, res) => {
  try {
    const { sensorId } = req.params;
    const { forecast = false } = req.query;
    
    // Récupérer localisation du capteur
    const sensorInfo = await SensorData.findOne({ sensorId }).sort({ timestamp: -1 });
    
    if (!sensorInfo?.location) {
      return res.status(404).json({
        success: false,
        message: 'Capteur non trouvé ou sans localisation'
      });
    }
    
    const weatherService = new WeatherService();
    
    // Météo actuelle
    const weatherResult = await weatherService.getCurrentWeather(
      null,
      sensorInfo.location.latitude,
      sensorInfo.location.longitude
    );
    
    if (!weatherResult.success) {
      return res.status(400).json(weatherResult);
    }
    
    const responseData = {
      sensorId,
      location: sensorInfo.location,
      current_weather: weatherResult.data,
      air_quality_impact: weatherService.analyzeAirQualityImpact(weatherResult.data)
    };
    
    // Ajouter prévisions si demandées
    if (forecast === 'true') {
      const forecastResult = await weatherService.getForecast(
        null,
        sensorInfo.location.latitude,
        sensorInfo.location.longitude,
        3
      );
      
      if (forecastResult.success) {
        responseData.forecast = forecastResult.data;
        
        // Analyser impact prévisionnel
        responseData.forecast_air_quality = forecastResult.data.daily.map(day => ({
          date: day.date,
          expected_impact: weatherService.predictAQIFromWeather(day),
          dust_risk: weatherService.assessDustRisk(day),
          ventilation_conditions: weatherService.assessVentilation(day)
        }));
      }
    }
    
    // Récupérer données récentes pour corrélation
    const recentData = await SensorData
      .find({ sensorId })
      .sort({ timestamp: -1 })
      .limit(24);
    
    if (recentData.length > 0) {
      // Analyser corrélation
      responseData.correlation = analyzeWeatherAirQualityCorrelation(
        weatherResult.data, 
        recentData
      );
      
      // Recommandations
      responseData.recommendations = generateWeatherRecommendations(
        weatherResult.data,
        responseData.correlation,
        sensorInfo.location.city
      );
    }
    
    res.json({
      success: true,
      data: responseData,
      message: `Météo et impact qualité air pour ${sensorId}`
    });
    
  } catch (error) {
    console.error('❌ Erreur météo capteur:', error.message);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération météo capteur'
    });
  }
});

// =====================================================
// FONCTIONS UTILITAIRES
// =====================================================

function analyzeWeatherAirQualityCorrelation(weather, sensorData) {
  if (!sensorData || sensorData.length === 0) {
    return { 
      correlation: 'insufficient_data',
      confidence: 0,
      analysis: 'Pas assez de données pour analyser la corrélation'
    };
  }

  const windSpeed = weather.current.wind.speed_kmh;
  const humidity = weather.current.humidity;
  const pressure = weather.current.pressure;
  
  // Calculer moyennes PM2.5
  const avgPM25 = sensorData.reduce((sum, data) => sum + (data.measurements.pm25 || 0), 0) / sensorData.length;
  const recent6h = sensorData.slice(0, 6);
  const avgPM25Recent = recent6h.reduce((sum, data) => sum + (data.measurements.pm25 || 0), 0) / recent6h.length;
  
  let correlation = {
    wind_dispersion: 'neutral',
    humidity_effect: 'neutral', 
    pressure_stability: 'neutral',
    trend: avgPM25Recent > avgPM25 ? 'increasing' : 'decreasing',
    confidence: 0.5
  };
  
  // Analyse vent
  if (windSpeed > 15) {
    correlation.wind_dispersion = 'beneficial';
    correlation.confidence += 0.2;
  } else if (windSpeed < 5) {
    correlation.wind_dispersion = 'detrimental';
    correlation.confidence += 0.2;
  }
  
  // Analyse humidité
  if (humidity > 80) {
    correlation.humidity_effect = 'detrimental';
    correlation.confidence += 0.1;
  } else if (humidity < 40) {
    correlation.humidity_effect = 'dust_risk';
    correlation.confidence += 0.1;
  }
  
  // Analyse pression
  if (pressure < 1010) {
    correlation.pressure_stability = 'inversion_risk';
    correlation.confidence += 0.1;
  }
  
  return {
    ...correlation,
    pm25_average_24h: Math.round(avgPM25 * 10) / 10,
    pm25_recent_6h: Math.round(avgPM25Recent * 10) / 10,
    weather_conditions: {
      wind_speed_kmh: windSpeed,
      humidity_percent: humidity,
      pressure_hpa: pressure
    }
  };
}

function generateWeatherRecommendations(weatherData, correlation, city) {
  const recommendations = [];
  const wind = weatherData.current.wind.speed_kmh;
  const humidity = weatherData.current.humidity;
  
  // Recommandations vent
  if (wind > 20) {
    recommendations.push({
      type: 'ventilation',
      priority: 'high',
      message: `💨 Vent fort à ${city} - Excellente opportunité d'aérer`,
      action: 'Ouvrez largement les fenêtres pendant 30-60 minutes'
    });
  } else if (wind < 5) {
    recommendations.push({
      type: 'precaution',
      priority: 'medium',
      message: `😷 Vent faible à ${city} - Risque de stagnation`,
      action: 'Surveillez la qualité de l\'air, limitez sorties prolongées'
    });
  }
  
  // Recommandations humidité
  if (humidity > 85) {
    recommendations.push({
      type: 'health',
      priority: 'medium',
      message: `💧 Humidité très élevée à ${city}`,
      action: 'Les particules restent en suspension, surveillez l\'AQI'
    });
  } else if (humidity < 30) {
    recommendations.push({
      type: 'dust',
      priority: 'medium',
      message: `🏜️ Air très sec à ${city}`,
      action: 'Risque accru de poussière, portez un masque si vent fort'
    });
  }
  
  // Recommandations tendance
  if (correlation.trend === 'increasing') {
    recommendations.push({
      type: 'trend',
      priority: 'medium',
      message: 'Tendance pollution en hausse',
      action: 'Surveillez l\'évolution dans les prochaines heures'
    });
  }
  
  return recommendations;
}

function analyzeCityWeatherCorrelation(weatherData, sensors) {
  if (!sensors || sensors.length === 0) {
    return { correlation: 'no_sensors', confidence: 0 };
  }
  
  const wind = weatherData.current.wind.speed_kmh;
  const avgAQI = sensors.reduce((sum, s) => sum + (s.avgAQI || 0), 0) / sensors.length;
  
  let impact = 'neutral';
  let confidence = 0.5;
  
  if (wind > 15 && avgAQI < 50) {
    impact = 'beneficial';
    confidence = 0.8;
  } else if (wind < 5 && avgAQI > 100) {
    impact = 'detrimental';
    confidence = 0.8;
  }
  
  return {
    correlation: impact,
    confidence: confidence,
    avg_aqi: Math.round(avgAQI),
    sensors_count: sensors.length
  };
}

function getWorstAirQualityImpact(enrichedData) {
  let worst = 'neutral';
  
  for (const cityData of enrichedData) {
    const impact = cityData.air_quality_impact.overall;
    if (impact === 'detrimental') {
      worst = 'detrimental';
      break;
    } else if (impact === 'beneficial' && worst === 'neutral') {
      worst = 'beneficial';
    }
  }
  
  return worst;
}


// GET /sensors/nearest - Trouver le capteur le plus proche de l'utilisateur
router.get('/nearest', async (req, res) => {
  try {
    const { latitude, longitude } = req.query;
    
    // 1. Validation des paramètres
    if (!latitude || !longitude) {
      return res.status(400).json({
        success: false,
        message: 'Latitude et longitude requises',
        example: '/api/sensors/nearest?latitude=14.6928&longitude=-17.4467'
      });
    }
    
    const userLat = parseFloat(latitude);
    const userLon = parseFloat(longitude);
    
    if (isNaN(userLat) || isNaN(userLon)) {
      return res.status(400).json({
        success: false,
        message: 'Latitude et longitude doivent être des nombres valides'
      });
    }
    
    // Validation range GPS
    if (userLat < -90 || userLat > 90 || userLon < -180 || userLon > 180) {
      return res.status(400).json({
        success: false,
        message: 'Coordonnées GPS invalides'
      });
    }
    
    // 2. Récupérer tous les capteurs
    const allSensors = await airGradientService.getSensorLocations();
    
    // 3. Récupérer le statut online/offline de chaque capteur
    const sensorsWithStatus = await Promise.all(
      allSensors.map(async (sensor) => {
        // Vérifier la dernière donnée du capteur (dans les 10 dernières minutes)
        const latestData = await SensorData
          .findOne({ sensorId: sensor.id })
          .sort({ timestamp: -1 });
        
        const isOnline = latestData && 
          (Date.now() - new Date(latestData.timestamp).getTime()) < 10 * 60 * 1000;
        
        // Calculer distance
        const distance = calculateDistance(
          userLat, 
          userLon, 
          sensor.coordinates.lat, 
          sensor.coordinates.lng
        );
        
        return {
          ...sensor,
          status: isOnline ? 'online' : 'offline',
          distance: Math.round(distance * 100) / 100, // Arrondir à 2 décimales
          lastUpdate: latestData?.timestamp,
          lastData: latestData
        };
      })
    );
    
    // 4. Trier par distance (plus proche en premier)
    const sortedByDistance = sensorsWithStatus.sort((a, b) => a.distance - b.distance);
    
    // 5. Filtrer pour ne garder que les capteurs online
    const onlineSensors = sortedByDistance.filter(s => s.status === 'online');
    
    // 6. Retourner le résultat
    if (onlineSensors.length === 0) {
      return res.json({
        success: false,
        message: 'Aucun capteur en ligne disponible',
        nearest_offline: sortedByDistance[0], // Le plus proche même si offline
        all_sensors_by_distance: sortedByDistance.slice(0, 5), // Les 5 plus proches
        user_location: {
          latitude: userLat,
          longitude: userLon
        }
      });
    }
    
    const nearestOnline = onlineSensors[0];
    
    res.json({
      success: true,
      nearest_sensor: nearestOnline,
      alternatives: onlineSensors.slice(1, 4), // 3 alternatives
      total_online_sensors: onlineSensors.length,
      total_sensors: allSensors.length,
      user_location: {
        latitude: userLat,
        longitude: userLon
      }
    });
    
  } catch (error) {
    console.error('❌ Erreur recherche capteur proche:', error.message);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la recherche du capteur le plus proche'
    });
  }
});

// Fonction utilitaire pour calculer la distance
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Rayon de la Terre en km
  
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  
  return R * c; // Distance en km
}

function toRadians(degrees) {
  return degrees * (Math.PI / 180);
}

/**
 * Calcule un AQI simple à partir des données du capteur
 * @param {Object} data - Données du capteur AirGradient
 * @returns {number} - Valeur AQI estimée
 */
function calculateAQIFromData(data) {
  if (!data) return null;
  
  const pm25 = data.pm02 || data.pm25 || 0;
  const pm10 = data.pm10 || 0;
  
  let aqi = 0;
  
  // Calcul AQI basé sur PM2.5 (formule simplifiée EPA)
  if (pm25 <= 12) {
    aqi = Math.max(aqi, (pm25 / 12) * 50);
  } else if (pm25 <= 35.4) {
    aqi = Math.max(aqi, 50 + ((pm25 - 12) / (35.4 - 12)) * 50);
  } else if (pm25 <= 55.4) {
    aqi = Math.max(aqi, 100 + ((pm25 - 35.4) / (55.4 - 35.4)) * 50);
  } else if (pm25 <= 150.4) {
    aqi = Math.max(aqi, 150 + ((pm25 - 55.4) / (150.4 - 55.4)) * 50);
  } else if (pm25 <= 250.4) {
    aqi = Math.max(aqi, 200 + ((pm25 - 150.4) / (250.4 - 150.4)) * 100);
  } else {
    aqi = Math.max(aqi, 300 + ((pm25 - 250.4) / (350.4 - 250.4)) * 100);
  }
  
  // Ajustement PM10 si nécessaire
  if (pm10 > 54) {
    aqi = Math.max(aqi, 100 + ((pm10 - 54) / (154 - 54)) * 50);
  }
  
  return Math.round(aqi);
}

module.exports = router;