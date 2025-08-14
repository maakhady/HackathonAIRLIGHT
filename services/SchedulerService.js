// services/SchedulerService.js - NIVEAUX DE SÉVÉRITÉ CORRIGÉS
const cron = require('node-cron');
const AirGradientService = require('./AirGradientService');
const AlertService = require('./AlertService');
const PredictionService = require('./PredictionService');
const SensorData = require('../models/SensorData');
const Alert = require('../models/Alert');
const Prediction = require('../models/Prediction');
const { triggerAlert, AlertMiddleware } = require('../middleware/alertMiddleware');

class SchedulerService {
  constructor() {
    this.airGradientService = new AirGradientService();
    this.alertService = new AlertService();
    this.predictionService = new PredictionService();
    this.jobs = new Map();
    this.isRunning = false;
  }

  // Initialiser tous les jobs programmés
  initialize() {
    if (this.isRunning) {
      console.log('⚠️ Scheduler déjà en cours d\'exécution');
      return;
    }

    console.log('🕐 Initialisation du scheduler avec prédictions IA...');
    
    this.setupSyncJob();
    this.setupPredictionJob();
    this.setupAlertCleanupJob();
    this.setupDataCleanupJob();
    this.setupPredictionCleanupJob();
    this.setupHealthCheckJob();
    this.setupStatsJob();
    this.setupAIHealthCheckJob();
    
    this.isRunning = true;
    console.log('✅ Scheduler initialisé avec succès (IA incluse)');
  }

  // Job de synchronisation avec AirGradient - Toutes les 4 minutes
  setupSyncJob() {
    const job = cron.schedule('*/4 * * * *', async () => {
      try {
        console.log('🔄 Début synchronisation AirGradient...');
        
        const allSensorsData = await this.airGradientService.fetchAllSensorsData();
        let savedCount = 0;
        let alertCount = 0;
        
        for (const { location, data } of allSensorsData) {
          try {
            const transformedData = this.airGradientService.transformDataForStorage(data, location);
            
            for (const sensorReading of transformedData) {
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
                
                // Vérifier les alertes
                const alerts = await this.alertService.checkAndCreateAlerts({
                  sensorId: sensorReading.sensorId,
                  measurements: sensorReading.measurements,
                  location: sensorReading.location
                });
                
                if (alerts && alerts.length > 0) {
                  alertCount += alerts.length;
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
          }
        }
        
        console.log(`✅ Sync terminée: ${savedCount} nouveaux enregistrements, ${alertCount} alertes`);
        this.broadcastSystemUpdate();
        
      } catch (error) {
        console.error('❌ Erreur synchronisation programmée:', error.message);
      }
    }, {
      scheduled: false
    });
    
    this.jobs.set('sync', job);
    job.start();
    console.log('📅 Job synchronisation AirGradient programmé (toutes les 4 minutes)');
  }

  // Job de génération de prédictions IA - Toutes les heures
  setupPredictionJob() {
    const job = cron.schedule('0 * * * *', async () => {
      try {
        console.log('🤖 Début génération prédictions IA...');
        
        // Récupérer les capteurs actifs (données dans les dernières 2 heures)
        const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
        const activeSensors = await SensorData.distinct('sensorId', {
          timestamp: { $gte: twoHoursAgo }
        });
        
        let successCount = 0;
        let errorCount = 0;
        let totalPredictions = 0;
        let alertsGenerated = 0;
        
        for (const sensorId of activeSensors) {
          try {
            // Générer prédictions pour les 6 prochaines heures
            const result = await this.predictionService.generatePrediction(sensorId, 6);
            
            if (result.success && result.predictions) {
              successCount++;
              totalPredictions += result.predictions.length;
              
              // Vérifier les alertes prédictives
              const alerts = await this.checkPredictiveAlerts(sensorId, result.predictions);
              alertsGenerated += alerts;
              
              console.log(`✅ ${result.predictions.length} prédictions générées pour ${sensorId}`);
            } else {
              errorCount++;
              console.log(`⚠️ Échec prédiction pour ${sensorId}: ${result.message}`);
            }
            
            // Délai pour éviter la surcharge
            await new Promise(resolve => setTimeout(resolve, 2000));
            
          } catch (error) {
            errorCount++;
            console.error(`❌ Erreur prédiction ${sensorId}:`, error.message);
          }
        }
        
        console.log(`🤖 Prédictions terminées: ${successCount}/${activeSensors.length} capteurs, ${totalPredictions} prédictions, ${alertsGenerated} alertes`);
        
        // Diffuser les statistiques mises à jour
        this.broadcastPredictionStats();
        
      } catch (error) {
        console.error('❌ Erreur job prédictions:', error.message);
      }
    }, {
      scheduled: false
    });
    
    this.jobs.set('predictions', job);
    job.start();
    console.log('📅 Job prédictions IA programmé (toutes les heures)');
  }

  // 🔧 CORRIGÉ: Job de vérification santé du service IA avec nouveaux niveaux
  setupAIHealthCheckJob() {
    const job = cron.schedule('*/30 * * * *', async () => {
      try {
        const aiHealth = await this.predictionService.checkAIServiceHealth();
        
        if (!aiHealth.available) {
          // Créer une alerte si le service IA est down
          const existingAlert = await Alert.findOne({
            alertType: 'ai_service_down',
            isActive: true,
            createdAt: { $gte: new Date(Date.now() - 60 * 60 * 1000) } // 1h
          });
          
          if (!existingAlert) {
            const aiDownAlert = {
              sensorId: 'SYSTEM',
              alertType: 'ai_service_down',
              severity: 'poor', // 🔧 CORRIGÉ: 'poor' au lieu de 'medium'
              qualityLevel: 'poor',
              referenceStandard: 'WHO_2021',
              message: '🤖 Service IA indisponible - Prédictions en mode dégradé',
              data: {
                error: aiHealth.error,
                fallbackMode: true,
                lastCheck: new Date()
              }
            };
            
            const savedAlert = await this.alertService.saveAlert(aiDownAlert);
            if (savedAlert) {
              triggerAlert(savedAlert);
            }
          }
          
          console.log('⚠️ Service IA indisponible:', aiHealth.error);
        } else {
          // Résoudre l'alerte si le service est de nouveau disponible
          await Alert.updateMany(
            {
              alertType: 'ai_service_down',
              isActive: true
            },
            {
              isActive: false,
              resolvedAt: new Date(),
              resolution: 'Service IA rétabli'
            }
          );
          
          console.log('✅ Service IA opérationnel');
        }
        
      } catch (error) {
        console.error('❌ Erreur vérification santé IA:', error.message);
      }
    }, {
      scheduled: false
    });
    
    this.jobs.set('aiHealthCheck', job);
    job.start();
    console.log('📅 Job vérification santé IA programmé (toutes les 30 minutes)');
  }

  // Job de nettoyage des prédictions - Tous les jours à 1h
  setupPredictionCleanupJob() {
    const job = cron.schedule('0 1 * * *', async () => {
      try {
        console.log('🧹 Nettoyage des anciennes prédictions...');
        const deletedCount = await this.predictionService.cleanupOldPredictions(7);
        console.log(`✅ ${deletedCount} anciennes prédictions supprimées`);
      } catch (error) {
        console.error('❌ Erreur nettoyage prédictions:', error.message);
      }
    }, {
      scheduled: false
    });
    
    this.jobs.set('predictionCleanup', job);
    job.start();
    console.log('📅 Job nettoyage prédictions programmé (1h00 tous les jours)');
  }

  // Jobs existants (alertCleanup, dataCleanup, healthCheck) - inchangés
  setupAlertCleanupJob() {
    const job = cron.schedule('0 2 * * *', async () => {
      try {
        console.log('🧹 Démarrage nettoyage automatique des alertes...');
        const deletedCount = await this.alertService.cleanupOldAlerts(30);
        console.log(`✅ Nettoyage alertes terminé: ${deletedCount} alertes supprimées`);
      } catch (error) {
        console.error('❌ Erreur nettoyage alertes:', error.message);
      }
    }, {
      scheduled: false
    });
    
    this.jobs.set('alertCleanup', job);
    job.start();
    console.log('📅 Job nettoyage alertes programmé (2h00 tous les jours)');
  }

  setupDataCleanupJob() {
    const job = cron.schedule('0 3 * * 0', async () => {
      try {
        console.log('🧹 Démarrage nettoyage automatique des données...');
        const cutoffDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
        const result = await SensorData.deleteMany({
          timestamp: { $lt: cutoffDate }
        });
        console.log(`✅ Nettoyage données terminé: ${result.deletedCount} enregistrements supprimés`);
      } catch (error) {
        console.error('❌ Erreur nettoyage données:', error.message);
      }
    }, {
      scheduled: false
    });
    
    this.jobs.set('dataCleanup', job);
    job.start();
    console.log('📅 Job nettoyage données programmé (dimanche 3h00)');
  }

  // 🔧 CORRIGÉ: Health check avec nouveaux niveaux de sévérité
  setupHealthCheckJob() {
    const job = cron.schedule('0 * * * *', async () => {
      try {
        console.log('🏥 Vérification santé des capteurs...');
        
        const sensors = this.airGradientService.getSensorLocations();
        const now = new Date();
        const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
        
        for (const sensor of sensors) {
          const lastData = await SensorData
            .findOne({ sensorId: sensor.id })
            .sort({ timestamp: -1 });
          
          if (!lastData || lastData.timestamp < oneHourAgo) {
            const existingAlert = await Alert.findOne({
              sensorId: sensor.id,
              alertType: 'sensor_offline',
              isActive: true,
              createdAt: { $gte: new Date(now.getTime() - 2 * 60 * 60 * 1000) }
            });
            
            if (!existingAlert) {
              const offlineAlert = {
                sensorId: sensor.id,
                alertType: 'sensor_offline',
                severity: 'poor', // 🔧 CORRIGÉ: 'poor' au lieu de 'medium'
                qualityLevel: 'poor',
                referenceStandard: 'WHO_2021',
                message: `📡 Capteur hors ligne: ${sensor.name} (${sensor.city})`,
                data: {
                  location: sensor.name,
                  lastSeen: lastData ? lastData.timestamp : 'Jamais',
                  offlineDuration: lastData ? 
                    Math.round((now - lastData.timestamp) / (60 * 1000)) + ' minutes' : 
                    'Inconnue'
                }
              };
              
              const savedAlert = await this.alertService.saveAlert(offlineAlert);
              if (savedAlert) {
                triggerAlert(savedAlert);
              }
            }
          }
        }
        
        console.log('✅ Vérification santé capteurs terminée');
        
      } catch (error) {
        console.error('❌ Erreur vérification santé:', error.message);
      }
    }, {
      scheduled: false
    });
    
    this.jobs.set('healthCheck', job);
    job.start();
    console.log('📅 Job vérification santé programmé (toutes les heures)');
  }

  // 🔧 CORRIGÉ: Stats job avec nouveaux niveaux
  setupStatsJob() {
    const job = cron.schedule('*/5 * * * *', async () => {
      try {
        const now = new Date();
        const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        
        // Stats alertes avec nouveaux niveaux
        const alertStats = await Alert.aggregate([
          { $match: { createdAt: { $gte: last24h } } },
          {
            $group: {
              _id: null,
              total: { $sum: 1 },
              active: { $sum: { $cond: ['$isActive', 1, 0] } },
              // 🔧 CORRIGÉ: Nouveaux niveaux de sévérité
              hazardous: { $sum: { $cond: [{ $eq: ['$severity', 'hazardous'] }, 1, 0] } },
              unhealthy: { $sum: { $cond: [{ $eq: ['$severity', 'unhealthy'] }, 1, 0] } },
              poor: { $sum: { $cond: [{ $eq: ['$severity', 'poor'] }, 1, 0] } },
              moderate: { $sum: { $cond: [{ $eq: ['$severity', 'moderate'] }, 1, 0] } },
              good: { $sum: { $cond: [{ $eq: ['$severity', 'good'] }, 1, 0] } },
              predictive: { $sum: { $cond: [{ $eq: ['$alertType', 'prediction_warning'] }, 1, 0] } }
            }
          }
        ]);
        
        // Stats capteurs
        const sensorStats = await SensorData.aggregate([
          { $match: { timestamp: { $gte: last24h } } },
          {
            $group: {
              _id: '$sensorId',
              lastUpdate: { $max: '$timestamp' },
              avgAQI: { $avg: '$airQualityIndex' },
              measurements: { $sum: 1 }
            }
          }
        ]);
        
        // Stats prédictions
        const predictionStats = await Prediction.aggregate([
          { $match: { createdAt: { $gte: last24h } } },
          {
            $group: {
              _id: null,
              totalPredictions: { $sum: 1 },
              avgConfidence: { $avg: '$confidence' },
              futurePredictions: {
                $sum: { $cond: [{ $gt: ['$predictionFor', now] }, 1, 0] }
              }
            }
          }
        ]);
        
        const systemStats = {
          alerts_24h: alertStats[0] || { 
            total: 0, active: 0, 
            hazardous: 0, unhealthy: 0, poor: 0, moderate: 0, good: 0,
            predictive: 0 
          },
          sensors: {
            total: sensorStats.length,
            active: sensorStats.filter(s => 
              new Date() - new Date(s.lastUpdate) < 60 * 60 * 1000
            ).length,
            measurements_24h: sensorStats.reduce((sum, s) => sum + s.measurements, 0)
          },
          predictions: predictionStats[0] || { totalPredictions: 0, avgConfidence: 0, futurePredictions: 0 },
          websocket_clients: AlertMiddleware ? AlertMiddleware.getConnectionStats().connectedClients : 0,
          system: {
            uptime: process.uptime(),
            memory: process.memoryUsage(),
            nodeVersion: process.version
          },
          timestamp: now
        };
        
        if (AlertMiddleware) {
          AlertMiddleware.broadcastSystemStats(systemStats);
        }
        
      } catch (error) {
        console.error('❌ Erreur diffusion stats:', error.message);
      }
    }, {
      scheduled: false
    });
    
    this.jobs.set('stats', job);
    job.start();
    console.log('📅 Job statistiques programmé (toutes les 5 minutes)');
  }

  // 🔧 CORRIGÉ: Méthodes utilitaires pour les prédictions avec nouveaux niveaux
  async checkPredictiveAlerts(sensorId, predictions) {
    let alertsCreated = 0;
    
    try {
      for (const prediction of predictions) {
        // Seuil d'alerte prédictive
        if (prediction.predictedPM25 > 50 && prediction.confidence > 0.7) {
          const hoursAhead = Math.round((new Date(prediction.predictionFor) - new Date()) / (60 * 60 * 1000));
          
          // 🔧 CORRIGÉ: Utiliser nouveaux niveaux de sévérité
          let severity, qualityLevel;
          if (prediction.predictedPM25 > 100) {
            severity = 'unhealthy';
            qualityLevel = 'very_poor';
          } else if (prediction.predictedPM25 > 75) {
            severity = 'poor';
            qualityLevel = 'poor';
          } else {
            severity = 'moderate';
            qualityLevel = 'moderate';
          }
          
          const alertData = {
            sensorId,
            alertType: 'prediction_warning',
            severity,
            qualityLevel,
            referenceStandard: 'WHO_2021',
            message: `🔮 Alerte prédictive: PM2.5 prévu à ${prediction.predictedPM25.toFixed(1)} µg/m³ dans ${hoursAhead}h`,
            data: {
              predictedValue: prediction.predictedPM25,
              predictedAQI: prediction.predictedAQI,
              confidence: prediction.confidence,
              predictionFor: prediction.predictionFor,
              hoursAhead
            }
          };
          
          // Vérifier doublons
          const existingAlert = await Alert.findOne({
            sensorId,
            alertType: 'prediction_warning',
            isActive: true,
            'data.predictionFor': prediction.predictionFor
          });
          
          if (!existingAlert) {
            const savedAlert = await this.alertService.saveAlert(alertData);
            if (savedAlert) {
              triggerAlert(savedAlert);
              alertsCreated++;
            }
          }
        }
      }
    } catch (error) {
      console.error('❌ Erreur alertes prédictives:', error.message);
    }
    
    return alertsCreated;
  }

  broadcastPredictionStats() {
    if (AlertMiddleware) {
      AlertMiddleware.broadcastSystemStats({
        type: 'predictions_update',
        message: 'Nouvelles prédictions IA disponibles',
        timestamp: new Date()
      });
    }
  }

  broadcastSystemUpdate() {
    try {
      if (AlertMiddleware) {
        AlertMiddleware.broadcastSystemStats({
          type: 'data_update',
          message: 'Nouvelles données de capteurs disponibles',
          timestamp: new Date()
        });
      }
    } catch (error) {
      console.error('❌ Erreur diffusion mise à jour:', error.message);
    }
  }

  // Méthodes existantes (stopAll, restartJob, etc.) - inchangées
  stopAll() {
    console.log('🛑 Arrêt de tous les jobs programmés...');
    
    this.jobs.forEach((job, name) => {
      job.stop();
      console.log(`📅 Job "${name}" arrêté`);
    });
    
    this.jobs.clear();
    this.isRunning = false;
    console.log('✅ Tous les jobs ont été arrêtés');
  }

  getJobsStatus() {
    const status = {};
    this.jobs.forEach((job, name) => {
      status[name] = {
        running: job.running,
        nextRun: job.nextDate ? job.nextDate().toISOString() : null
      };
    });
    return {
      isRunning: this.isRunning,
      totalJobs: this.jobs.size,
      jobs: status
    };
  }

  // Exécution manuelle du job de prédictions
  async runPredictionJobManually() {
    console.log('🔧 Exécution manuelle du job prédictions...');
    
    try {
      const activeSensors = await SensorData.distinct('sensorId', {
        timestamp: { $gte: new Date(Date.now() - 2 * 60 * 60 * 1000) }
      });
      
      let results = [];
      
      for (const sensorId of activeSensors.slice(0, 3)) { // Limiter à 3 capteurs pour le test
        const result = await this.predictionService.generatePrediction(sensorId, 3);
        results.push({
          sensorId,
          success: result.success,
          predictionsCount: result.predictions ? result.predictions.length : 0
        });
      }
      
      return { results, totalSensors: activeSensors.length };
      
    } catch (error) {
      console.error('❌ Erreur job prédictions manuel:', error.message);
      throw error;
    }
  }
}

// Instance singleton
const schedulerService = new SchedulerService();

module.exports = schedulerService;