// services/SchedulerService.js - ALERTES INTELLIGENTES INTÉGRÉES + MÉTÉO
const cron = require('node-cron');
const AirGradientService = require('./AirGradientService');
const AlertService = require('./AlertService');
const EnhancedAlertService = require('./EnhancedAlertService'); 
const PredictionService = require('./PredictionService');
const WeatherService = require('./WeatherService');
const SensorData = require('../models/SensorData');
const Alert = require('../models/Alert');
const Prediction = require('../models/Prediction');
const { translateWeatherAlertMessage, getHarmattanRecommendations } = require('./weather-translations');

const { triggerAlert, AlertMiddleware } = require('../middleware/alertMiddleware');

class SchedulerService {
  constructor() {
    this.airGradientService = new AirGradientService();
    this.alertService = new AlertService();
    this.enhancedAlertService = new EnhancedAlertService(); 
    this.predictionService = new PredictionService();
    this.weatherService = new WeatherService();
    this.jobs = new Map();
    this.isRunning = false;

    // Buffer de logs en mémoire
    this.executionLogs = [];
    this.MAX_LOGS = 500;

    this.PREDICTION_HOURS = 168; // 7 jours
    this.REGENERATION_THRESHOLD = 120; // Régénérer si < 5 jours restants (garantit toujours 24h/48h dispo)
  }
 

  // Ajout log
  addLog(level, message, meta = {}) {
    const entry = {
      ts: new Date().toISOString(),
      level, // 'info' | 'warn' | 'error' | 'debug'
      message,
      meta
    };
    this.executionLogs.push(entry);
    if (this.executionLogs.length > this.MAX_LOGS) {
      this.executionLogs.shift();
    }
    return entry;
  }

  // Exposer les logs
  getExecutionLogs({ limit = 100, level } = {}) {
    const src = level ? this.executionLogs.filter(l => l.level === level) : this.executionLogs;
    const safeLimit = Math.max(1, Math.min(limit, this.MAX_LOGS));
    return src.slice(-safeLimit);
  }

  // Initialiser tous les jobs programmés avec météo
  initialize() {
    if (this.isRunning) {
      this.addLog('warn', 'Scheduler deja en cours d execution');
      console.log('⚠️ Scheduler déjà en cours d\'exécution');
      return;
    }

    this.addLog('info', 'Initialisation du scheduler COMPLET (IA + Météo + Alertes + Régénération 168h)');
    console.log('🕐 Initialisation du scheduler COMPLET (IA + Météo + Alertes + Régénération 168h)...');
    
    this.setupSyncJob();
    this.setupPredictionJob();
    this.setupWeeklyPredictionRegenerationJob();
    this.setupAlertCleanupJob();
    this.setupDataCleanupJob();
    this.setupPredictionCleanupJob();
    this.setupHealthCheckJob();
    this.setupStatsJob();
    this.setupAIHealthCheckJob();
    
    // Jobs météo
    this.setupWeatherUpdateJob();
    this.setupWeatherForecastJob();
    
    this.isRunning = true;
    this.addLog('info', 'Scheduler initialisé avec succès - TOUTES LES FONCTIONNALITÉS ACTIVES');
    console.log(' Scheduler initialisé avec succès - TOUTES LES FONCTIONNALITÉS ACTIVES');
  }

  // ✅ MODIFIÉ: Job de synchronisation avec alertes intelligentes - Toutes les 45 secondes
  setupSyncJob() {
    const job = cron.schedule('*/45 * * * * *', async () => {
      const started = Date.now();
      this.addLog('info', '🔄 Début synchronisation AirGradient');
       
      try {
        console.log('🔄 Début synchronisation AirGradient...');
                 
        const allSensorsData = await this.airGradientService.fetchAllSensorsData();
        let savedCount = 0;
        let alertCount = 0;
        let standardAlertCount = 0;
        let enhancedAlertCount = 0;
                 
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
                
                // ✅ 1️⃣ Alertes standards (WHO/EPA)
                const standardAlerts = await this.alertService.checkAndCreateAlerts({
                  sensorId: sensorReading.sensorId,
                  measurements: sensorReading.measurements,
                  location: sensorReading.location
                });
                
                // ✅ 2️⃣ Alertes intelligentes (pics, variations, zones à risque)
                let enhancedAlerts = [];
                try {
                  enhancedAlerts = await this.enhancedAlertService.analyzeAndCreateAlerts(
                    sensorReading.sensorId,
                    sensorReading.location?.name || sensorReading.sensorId,
                    sensorReading.location?.city || 'Dakar',
                    sensorReading.measurements
                  );
                } catch (error) {
                  console.error('❌ Erreur alertes intelligentes:', error.message);
                  this.addLog('error', 'Erreur alertes intelligentes', { 
                    sensorId: sensorReading.sensorId, 
                    error: error.message 
                  });
                }
                
                // ✅ 3️⃣ Combiner et diffuser TOUTES les alertes
                const allAlerts = [
                  ...(standardAlerts || []),
                  ...(enhancedAlerts || [])
                ];
                
                if (allAlerts.length > 0) {
                  alertCount += allAlerts.length;
                  standardAlertCount += (standardAlerts || []).length;
                  enhancedAlertCount += (enhancedAlerts || []).length;
                  
                  allAlerts.forEach(alert => {
                    if (alert && alert._id) {
                      triggerAlert(alert);
                    }
                  });
                  
                  // Log détaillé des alertes créées
                  if (enhancedAlerts.length > 0) {
                    console.log(`🎯 ${enhancedAlerts.length} alertes intelligentes créées pour ${sensorReading.location?.name || sensorReading.sensorId}`);
                  }
                }
              }
            }
                       
          } catch (error) {
            console.error(`❌ Erreur traitement ${location.name}:`, error.message);
            this.addLog('error', `Erreur traitement ${location.name}`, { error: error.message });
          }
        }
                 
        const syncMsg = `✅ Sync terminée: ${savedCount} enregistrements, ${alertCount} alertes (${standardAlertCount} standard + ${enhancedAlertCount} intelligente)`;
        console.log(syncMsg);
        this.addLog('info', syncMsg, { 
          duration_ms: Date.now() - started, 
          savedCount, 
          alertCount,
          standardAlertCount,
          enhancedAlertCount
        });
        this.broadcastSystemUpdate();
                 
      } catch (error) {
        console.error('❌ Erreur synchronisation programmée:', error.message);
        this.addLog('error', 'Erreur synchronisation programmée', { error: error.message });
      }
    }, {
      scheduled: false
    });
         
    this.jobs.set('sync', job);
    job.start();
    this.addLog('info', '- Job synchronisation AirGradient programmé (toutes les 45 secondes)');
    console.log('- Job synchronisation AirGradient programmé (toutes les 45 secondes)');
  }

  // Job de génération de prédictions IA - Toutes les heures
  setupPredictionJob() {
  const job = cron.schedule('0 */6 * * *', async () => {  // ✅ Changé de '0 * * * *' à '0 */6 * * *'
    const started = Date.now();
    this.addLog('info', '🤖 Début génération prédictions IA complètes (168h)');  // ✅ Changé le message

    try {
      console.log('🤖 Début génération prédictions IA complètes (168h)...');  // ✅ Changé le message
      
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
      const activeSensors = await SensorData.distinct('sensorId', {
        timestamp: { $gte: twoHoursAgo }
      });
      
      let successCount = 0;
      let errorCount = 0;
      let totalPredictions = 0;
      let alertsGenerated = 0;
      let skippedCount = 0;  // ✅ Ajouté
      
      for (const sensorId of activeSensors) {
        try {
          // Compter les prédictions futures encore valides (pas de filtre sur createdAt)
          const existingPredictions = await Prediction.countDocuments({
            sensorId,
            predictionFor: { $gte: new Date() }
          });

          // Skip seulement si le capteur a encore assez de prédictions futures
          if (existingPredictions >= this.REGENERATION_THRESHOLD) {
            console.log(`⏭️ ${sensorId}: ${existingPredictions} prédictions futures, skip`);
            skippedCount++;
            continue;
          }

          // ✅ Génère 168h au lieu de 6h
          const result = await this.predictionService.generatePrediction(sensorId, 168);  // ✅ Changé de 6 à 168
          
          if (result.success && result.predictions) {
            successCount++;
            totalPredictions += result.predictions.length;
            
            const alerts = await this.checkPredictiveAlerts(sensorId, result.predictions);
            alertsGenerated += alerts;
            
            console.log(`✅ ${result.predictions.length} prédictions (7 jours) pour ${sensorId}`);  // ✅ Changé le message
          } else {
            errorCount++;
          }
          
          // ✅ Délai plus long entre capteurs (service IA plus sollicité)
          await new Promise(resolve => setTimeout(resolve, 3000));  // ✅ Changé de 2000 à 3000
          
        } catch (error) {
          errorCount++;
          console.error(`❌ Erreur prédiction ${sensorId}:`, error.message);  // ✅ Changé le message
        }
      }
      
      console.log(`🤖 Prédictions complètes terminées: ${successCount}/${activeSensors.length} capteurs, ${skippedCount} ignorés`);  // ✅ Changé le message
      this.addLog('info', '🤖 Prédictions complètes terminées', {  // ✅ Changé le message
        duration_ms: Date.now() - started,
        successCount, 
        errorCount, 
        skippedCount,  // ✅ Ajouté
        totalPredictions, 
        alertsGenerated
      });
      
      this.broadcastPredictionStats();
      
    } catch (error) {
      console.error('❌ Erreur job prédictions complètes:', error.message);  // ✅ Changé le message
      this.addLog('error', 'Erreur job prédictions complètes', { error: error.message });  // ✅ Changé le message
    }
  }, {
    scheduled: false
  });
  
  this.jobs.set('predictions', job);
  job.start();
  this.addLog('info', '- Job prédictions IA complètes programmé (toutes les 6 heures)');  // ✅ Changé le message
  console.log('✅ Job prédictions IA complètes (168h) programmé (toutes les 6 heures)');  // ✅ Changé le message
}

  // ✅ NOUVEAU: Job de régénération automatique des prédictions 168h - Tous les jours à 2h
  setupWeeklyPredictionRegenerationJob() {
    const job = cron.schedule('0 2 * * *', async () => {
      const started = Date.now();
      this.addLog('info', '🔄 Début régénération automatique prédictions 168h');

      try {
        console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('🤖 RÉGÉNÉRATION AUTOMATIQUE DES PRÉDICTIONS 7 JOURS');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
        console.log(`📅 ${new Date().toLocaleString('fr-FR')}\n`);
        
        const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
        const activeSensors = await SensorData.distinct('sensorId', {
          timestamp: { $gte: twoHoursAgo }
        });
        
        console.log(`📡 ${activeSensors.length} capteurs actifs trouvés\n`);
        
        const results = {
          total: activeSensors.length,
          upToDate: 0,
          regenerated: 0,
          failed: 0,
          details: []
        };
        
        for (let i = 0; i < activeSensors.length; i++) {
          const sensorId = activeSensors[i];
          console.log(`[${i + 1}/${activeSensors.length}] 📍 ${sensorId}`);
          
          try {
            // Compter les prédictions futures restantes
            const now = new Date();
            const futurePredictions = await Prediction.countDocuments({
              sensorId: sensorId,
              predictionFor: { $gt: now }
            });
            
            console.log(`   📊 Prédictions restantes: ${futurePredictions}/${this.PREDICTION_HOURS} (seuil: ${this.REGENERATION_THRESHOLD}h)`);
            
            // Si moins de 3 jours restants → régénérer
            if (futurePredictions < this.REGENERATION_THRESHOLD) {
              console.log(`   🔄 Régénération nécessaire (< ${this.REGENERATION_THRESHOLD}h)...`);
              
              const result = await this.predictionService.generatePrediction(
                sensorId,
                this.PREDICTION_HOURS
              );
              
              if (result.success && result.predictions) {
                results.regenerated++;
                console.log(`   ✅ ${result.predictions.length} nouvelles prédictions générées`);
                console.log(`      📈 PM2.5 moyen: ${result.avgPM25?.toFixed(1) || 'N/A'}`);
                console.log(`      🎯 Confiance moyenne: ${((result.avgConfidence || 0) * 100).toFixed(1)}%\n`);
                
                results.details.push({
                  sensorId,
                  regenerated: true,
                  count: result.predictions.length,
                  avgPM25: result.avgPM25,
                  avgConfidence: result.avgConfidence
                });
                
                // Vérifier alertes prédictives
                await this.checkPredictiveAlerts(sensorId, result.predictions);
              } else {
                results.failed++;
                console.log(`   ❌ Échec régénération: ${result.message}\n`);
                
                results.details.push({
                  sensorId,
                  regenerated: false,
                  error: result.message
                });
              }
              
            } else {
              results.upToDate++;
              console.log(`   ✅ Prédictions suffisantes (${futurePredictions}/${this.PREDICTION_HOURS})\n`);
              
              results.details.push({
                sensorId,
                skipped: true,
                existingCount: futurePredictions
              });
            }
            
            // Délai entre capteurs pour ne pas surcharger le service IA
            if (i < activeSensors.length - 1) {
              await new Promise(resolve => setTimeout(resolve, 3000));
            }
            
          } catch (error) {
            results.failed++;
            console.error(`   ❌ Erreur: ${error.message}\n`);
            
            results.details.push({
              sensorId,
              regenerated: false,
              error: error.message
            });
          }
        }
        
        // Rapport final
        console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log(' RÉSUMÉ DE LA RÉGÉNÉRATION');
        console.log(`   Total capteurs: ${results.total}`);
        console.log(`    Déjà à jour: ${results.upToDate}`);
        console.log(`    Régénérés: ${results.regenerated}`);
        console.log(`    Échecs: ${results.failed}`);
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
        
        this.addLog('info', '🤖 Régénération 168h terminée', {
          duration_ms: Date.now() - started,
          ...results
        });
        
        // Broadcast mise à jour
        this.broadcastPredictionStats();
        
        if (AlertMiddleware) {
          AlertMiddleware.broadcastSystemStats({
            type: 'prediction_regeneration',
            message: `Régénération 7 jours: ${results.regenerated} capteurs mis à jour`,
            results: results,
            timestamp: new Date()
          });
        }
        
      } catch (error) {
        console.error('❌ Erreur job régénération 168h:', error.message);
        this.addLog('error', 'Erreur job régénération 168h', { error: error.message });
      }
    }, {
      scheduled: false
    });
    
    this.jobs.set('weeklyPredictionRegeneration', job);
    job.start();
    this.addLog('info', `- Job régénération 168h programmé (2h00 tous les jours, seuil: ${this.REGENERATION_THRESHOLD}h)`);
    console.log(` Job régénération 168h programmé (2h00 tous les jours, seuil: ${this.REGENERATION_THRESHOLD}h)`);
  }

  // Job de mise à jour météo - Toutes les 30 minutes
  setupWeatherUpdateJob() {
    const job = cron.schedule('*/30 * * * *', async () => {
      const started = Date.now();
      this.addLog('info', '🌤️ Mise à jour météo programmée');

      try {
        console.log('🌤️ Mise à jour météo programmée...');
        
        const weatherData = await this.weatherService.getWeatherForAllSensorCities();
        
        if (weatherData.success) {
          let alertsCreated = 0;
          const impacts = [];
          
          for (const cityWeather of weatherData.data) {
            if (cityWeather.success) {
              const impact = this.weatherService.analyzeAirQualityImpact(cityWeather.data);
              
              impacts.push({
                city: cityWeather.city,
                weather: {
                  temperature: cityWeather.data.current.temperature,
                  humidity: cityWeather.data.current.humidity,
                  wind_speed: cityWeather.data.current.wind.speed_kmh,
                  description: cityWeather.data.current.weather.description
                },
                impact: impact,
                timestamp: new Date()
              });
              
              const weatherAlerts = await this.checkWeatherAirQualityAlerts(cityWeather.data, cityWeather.city);
              alertsCreated += weatherAlerts.length;
            }
          }
          
          if (AlertMiddleware) {
            AlertMiddleware.broadcastSystemStats({
              type: 'weather_update',
              timestamp: new Date(),
              impacts: impacts,
              summary: `Météo mise à jour pour ${weatherData.summary.successful} villes`,
              alerts_created: alertsCreated
            });
          }
          
          console.log(`✅ Météo mise à jour: ${weatherData.summary.successful} villes, ${alertsCreated} alertes créées`);
          this.addLog('info', '✅ Météo mise à jour', {
            duration_ms: Date.now() - started,
            cities: weatherData.summary.successful,
            alerts_created: alertsCreated
          });
        } else {
          console.log('⚠️ Erreur mise à jour météo:', weatherData.error);
          this.addLog('warn', 'Erreur mise à jour météo', { error: weatherData.error });
        }
        
      } catch (error) {
        console.error('❌ Erreur job météo:', error.message);
        this.addLog('error', 'Erreur job météo', { error: error.message });
      }
    }, {
      scheduled: false
    });
    
    this.jobs.set('weatherUpdate', job);
    job.start();
    this.addLog('info', '- Job mise à jour météo programmé (toutes les 30 minutes)');
    console.log('- Job mise à jour météo programmé (toutes les 30 minutes)');
  }

  // Job de prévisions météo avancées - Tous les jours à 6h
  setupWeatherForecastJob() {
    const job = cron.schedule('0 6 * * *', async () => {
      const started = Date.now();
      this.addLog('info', '🌤️ Génération prévisions météo avancées');

      try {
        console.log('🌤️ Génération prévisions météo avancées...');
        
        let totalForecasts = 0;
        let alertsCreated = 0;
        
        for (const city of this.weatherService.sensorCities) {
          try {
            const forecast = await this.weatherService.getForecast(city.name, null, null, 5);
            
            if (forecast.success) {
              totalForecasts++;
              
              const preventiveAlerts = await this.analyzeForecastForAlerts(city.name, forecast.data);
              alertsCreated += preventiveAlerts.length;
            }
            
            await new Promise(resolve => setTimeout(resolve, 2000));
            
          } catch (error) {
            console.error(`❌ Erreur prévisions ${city.name}:`, error.message);
            this.addLog('error', 'Erreur prévisions ville', { city: city.name, error: error.message });
          }
        }
        
        console.log(`✅ Prévisions météo: ${totalForecasts} villes, ${alertsCreated} alertes préventives`);
        this.addLog('info', '✅ Prévisions météo terminées', {
          duration_ms: Date.now() - started,
          totalForecasts,
          alertsCreated
        });
        
      } catch (error) {
        console.error('❌ Erreur job prévisions météo:', error.message);
        this.addLog('error', 'Erreur job prévisions météo', { error: error.message });
      }
    }, {
      scheduled: false
    });
    
    this.jobs.set('weatherForecast', job);
    job.start();
    this.addLog('info', '- Job prévisions météo programmé (6h00 tous les jours)');
    console.log('- Job prévisions météo programmé (6h00 tous les jours)');
  }

  // Vérifier alertes météo/qualité air
  async checkWeatherAirQualityAlerts(weatherData, cityName) {
    const alerts = [];
    
    try {
      const wind = weatherData.current.wind.speed_kmh;
      const humidity = weatherData.current.humidity;
      const pressure = weatherData.current.pressure;
      const temperature = weatherData.current.temperature;
      
      // ✅ Normaliser le sensorId pour cohérence
      const sensorId = `WEATHER_${cityName.toUpperCase().replace(/\s+/g, '-').replace(/É|È|Ê/g, 'E')}`;
      
      // 1️⃣ Alerte conditions stagnantes
      if (wind < 5 && humidity > 80) {
        const alertData = {
          sensorId: sensorId,
          alertType: 'weather_air_quality',
          severity: 'poor',
          qualityLevel: 'poor',
          referenceStandard: 'METEOROLOGICAL',
          message: `🌫️ Conditions météo défavorables à ${cityName} - Stagnation possible des polluants`,
          data: {
            weatherConditions: {
              wind_speed_kmh: wind,
              humidity_percent: humidity,
              temperature_celsius: temperature,
              impact: 'Dispersion réduite des polluants',
              city: cityName // ✅ Ajouté
            },
            healthInfo: {
              impact: 'Conditions favorables à l\'accumulation de pollution',
              recommendations: [
                'Surveillez la qualité de l\'air',
                'Limitez les activités extérieures prolongées',
                'Utilisez un purificateur d\'air en intérieur'
              ]
            },
            environmentalContext: {
              city: cityName,
              harmattan: this.weatherService.isHarmattanSeason(),
              season: this.weatherService.getCurrentSeason()
            }
          }
        };
        
        const existingAlert = await Alert.findOne({
          sensorId: alertData.sensorId,
          alertType: 'weather_air_quality',
          isActive: true,
          createdAt: { $gte: new Date(Date.now() - 4 * 60 * 60 * 1000) }
        });
        
        if (!existingAlert) {
          const savedAlert = await this.alertService.saveAlert(alertData);
          if (savedAlert) {
            triggerAlert(savedAlert);
            alerts.push(savedAlert);
          }
        }
      }
      
      // 2️⃣ Alerte vent fort
      if (wind > 30) {
        const alertData = {
          sensorId: sensorId,
          alertType: 'weather_air_quality',
          severity: 'moderate',
          qualityLevel: 'moderate',
          referenceStandard: 'METEOROLOGICAL',
          message: `💨 Vent fort à ${cityName} (${wind} km/h) - Risque de soulèvement de poussière`,
          data: {
            weatherConditions: {
              wind_speed_kmh: wind,
              humidity_percent: humidity,
              impact: 'Possible augmentation PM10/poussière',
              city: cityName // ✅ Ajouté
            },
            healthInfo: {
              impact: 'Risque d\'augmentation des particules en suspension',
              recommendations: [
                'Fermez les fenêtres si vent de poussière',
                'Portez un masque à l\'extérieur si nécessaire',
                'Surveillance renforcée des niveaux PM10'
              ]
            },
            environmentalContext: {
              city: cityName,
              harmattan: this.weatherService.isHarmattanSeason(),
              dust_risk: 'elevated'
            }
          }
        };
        
        const existingWindAlert = await Alert.findOne({
          sensorId: alertData.sensorId,
          alertType: 'weather_air_quality',
          isActive: true,
          'data.weatherConditions.wind_speed_kmh': { $gte: 25 },
          createdAt: { $gte: new Date(Date.now() - 2 * 60 * 60 * 1000) }
        });
        
        if (!existingWindAlert) {
          const savedAlert = await this.alertService.saveAlert(alertData);
          if (savedAlert) {
            triggerAlert(savedAlert);
            alerts.push(savedAlert);
          }
        }
      }
      
      // 3️⃣ Alerte chaleur extrême
      if (temperature > 35 && humidity > 70) {
        const alertData = {
          sensorId: sensorId,
          alertType: 'weather_air_quality',
          severity: 'unhealthy',
          qualityLevel: 'poor',
          referenceStandard: 'METEOROLOGICAL',
          message: `🌡️ Chaleur et humidité extrêmes à ${cityName} - Conditions défavorables à la qualité de l'air`,
          data: {
            weatherConditions: {
              temperature_celsius: temperature,
              humidity_percent: humidity,
              heat_index: this.calculateHeatIndex(temperature, humidity),
              impact: 'Formation accrue d\'ozone et stress respiratoire',
              city: cityName // ✅ Ajouté
            },
            healthInfo: {
              impact: 'Conditions favorables à la pollution photochimique',
              recommendations: [
                'Évitez les activités extérieures aux heures chaudes',
                'Hydratez-vous fréquemment',
                'Groupes sensibles: restez en intérieur climatisé'
              ],
              sensitiveGroups: ['Enfants', 'Personnes âgées', 'Asthmatiques', 'Cardiaques']
            },
            environmentalContext: {
              city: cityName
            }
          }
        };
        
        const existingHeatAlert = await Alert.findOne({
          sensorId: alertData.sensorId,
          alertType: 'weather_air_quality',
          isActive: true,
          'data.weatherConditions.temperature_celsius': { $gte: 33 },
          createdAt: { $gte: new Date(Date.now() - 6 * 60 * 60 * 1000) }
        });
        
        if (!existingHeatAlert) {
          const savedAlert = await this.alertService.saveAlert(alertData);
          if (savedAlert) {
            triggerAlert(savedAlert);
            alerts.push(savedAlert);
          }
        }
      }
      
      // 4️⃣ Alerte Harmattan - ✅ AVEC TRADUCTIONS
      if (this.weatherService.isHarmattanSeason() && wind > 15 && humidity < 30) {
        const alertData = {
          sensorId: sensorId,
          alertType: 'weather_air_quality',
          severity: 'poor',
          qualityLevel: 'poor',
          referenceStandard: 'METEOROLOGICAL',
          message: translateWeatherAlertMessage('harmattan_warning', cityName), // ✅ Message traduit
          data: {
            weatherConditions: {
              wind_speed_kmh: wind,
              humidity_percent: humidity,
              season: 'harmattan',
              impact: 'Transport de poussière depuis le Sahara',
              city: cityName // ✅ Ajouté
            },
            healthInfo: {
              impact: 'Augmentation significative des particules PM2.5 et PM10',
              recommendations: getHarmattanRecommendations(), // ✅ Recommandations traduites
              sensitiveGroups: ['Enfants', 'Personnes âgées', 'Asthmatiques', 'Personnes avec maladies respiratoires']
            },
            environmentalContext: {
              city: cityName,
              harmattan: true,
              dust_source: 'Sahara',
              expected_duration: '48-72h'
            }
          }
        };
        
        const existingHarmattanAlert = await Alert.findOne({
          sensorId: alertData.sensorId,
          alertType: 'weather_air_quality',
          isActive: true,
          'data.environmentalContext.harmattan': true,
          createdAt: { $gte: new Date(Date.now() - 12 * 60 * 60 * 1000) }
        });
        
        if (!existingHarmattanAlert) {
          const savedAlert = await this.alertService.saveAlert(alertData);
          if (savedAlert) {
            triggerAlert(savedAlert);
            alerts.push(savedAlert);
            console.log(`🌪️ Alerte Harmattan créée: ${alertData.message}`); // ✅ Log
          }
        }
      }
      
    } catch (error) {
      console.error('❌ Erreur vérification alertes météo:', error.message);
      this.addLog('error', 'Erreur vérification alertes météo', { city: cityName, error: error.message });
    }
    
    return alerts;
  }

  // Analyser prévisions pour alertes préventives
  async analyzeForecastForAlerts(cityName, forecastData) {
    const alerts = [];
    
    try {
      for (const day of forecastData.daily.slice(0, 3)) {
        const date = new Date(day.date);
        const hoursAhead = Math.round((date - new Date()) / (60 * 60 * 1000));
        
        if (day.wind.avg_speed < 8 && day.humidity.avg > 75) {
          const alertData = {
            sensorId: `WEATHER_FORECAST_${cityName.toUpperCase()}`,
            alertType: 'weather_forecast_warning',
            severity: 'moderate',
            qualityLevel: 'moderate',
            referenceStandard: 'METEOROLOGICAL',
            message: `- Prévision météo défavorable à ${cityName} pour ${day.date} - Conditions de stagnation attendues`,
            data: {
              forecastDate: day.date,
              hoursAhead: hoursAhead,
              predictedConditions: {
                wind_avg_speed: day.wind.avg_speed,
                humidity_avg: day.humidity.avg,
                temperature_range: `${day.temperature.min}-${day.temperature.max}°C`
              },
              healthInfo: {
                impact: 'Prévision de conditions favorables à l\'accumulation de polluants',
                recommendations: [
                  'Planifiez vos activités extérieures tôt le matin',
                  'Évitez les efforts physiques intenses ce jour-là',
                  'Préparez-vous à fermer les fenêtres si nécessaire'
                ]
              },
              isPredictive: true,
              expiresAt: new Date(date.getTime() + 24 * 60 * 60 * 1000)
            }
          };
          
          const existingForecastAlert = await Alert.findOne({
            sensorId: alertData.sensorId,
            alertType: 'weather_forecast_warning',
            'data.forecastDate': day.date,
            isActive: true
          });
          
          if (!existingForecastAlert) {
            const savedAlert = await this.alertService.saveAlert(alertData);
            if (savedAlert) {
              alerts.push(savedAlert);
            }
          }
        }
      }
      
    } catch (error) {
      console.error('❌ Erreur analyse prévisions:', error.message);
      this.addLog('error', 'Erreur analyse prévisions', { city: cityName, error: error.message });
    }
    
    return alerts;
  }

  // Calculer indice de chaleur
  calculateHeatIndex(tempC, humidity) {
    const tempF = (tempC * 9/5) + 32;
    
    const hi = -42.379 + 
      2.04901523 * tempF + 
      10.14333127 * humidity - 
      0.22475541 * tempF * humidity - 
      0.00683783 * tempF * tempF - 
      0.05481717 * humidity * humidity + 
      0.00122874 * tempF * tempF * humidity + 
      0.00085282 * tempF * humidity * humidity - 
      0.00000199 * tempF * tempF * humidity * humidity;
    
    return Math.round((hi - 32) * 5/9);
  }

  // Job de vérification santé IA
  setupAIHealthCheckJob() {
    // ⏱️ Toutes les 14 min pour garder Flask éveillé (Render endort après 15 min)
    const job = cron.schedule('*/14 * * * *', async () => {
      const started = Date.now();
      this.addLog('info', '🔎 Vérification santé du service IA');

      try {
        const aiHealth = await this.predictionService.checkAIServiceHealth();
        
        if (!aiHealth.available) {
          const existingAlert = await Alert.findOne({
            alertType: 'ai_service_down',
            isActive: true,
            createdAt: { $gte: new Date(Date.now() - 60 * 60 * 1000) }
          });
          
          if (!existingAlert) {
            const aiDownAlert = {
              sensorId: 'SYSTEM',
              alertType: 'ai_service_down',
              severity: 'poor',
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
          this.addLog('warn', 'Service IA indisponible', { error: aiHealth.error, duration_ms: Date.now() - started });
        } else {
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
          this.addLog('info', 'Service IA opérationnel', { duration_ms: Date.now() - started });
        }
        
      } catch (error) {
        console.error('❌ Erreur vérification santé IA:', error.message);
        this.addLog('error', 'Erreur vérification santé IA', { error: error.message });
      }
    }, {
      scheduled: false
    });
    
    this.jobs.set('aiHealthCheck', job);
    job.start();
    this.addLog('info', '- Job vérification santé IA programmé (toutes les 14 minutes)');
    console.log('- Job vérification santé IA programmé (toutes les 14 minutes)');
  }

  // Job de nettoyage prédictions
  setupPredictionCleanupJob() {
    const job = cron.schedule('0 1 * * *', async () => {
      const started = Date.now();
      this.addLog('info', '🧹 Nettoyage des anciennes prédictions démarré');

      try {
        console.log('🧹 Nettoyage des anciennes prédictions...');
        const deletedCount = await this.predictionService.cleanupOldPredictions(7);
        console.log(`✅ ${deletedCount} anciennes prédictions supprimées`);
        this.addLog('info', '✅ Nettoyage anciennes prédictions terminé', { duration_ms: Date.now() - started, deletedCount });
      } catch (error) {
        console.error('❌ Erreur nettoyage prédictions:', error.message);
        this.addLog('error', 'Erreur nettoyage prédictions', { error: error.message });
      }
    }, {
      scheduled: false
    });
    
    this.jobs.set('predictionCleanup', job);
    job.start();
    this.addLog('info', '- Job nettoyage prédictions programmé (1h00 tous les jours)');
    console.log('- Job nettoyage prédictions programmé (1h00 tous les jours)');
  }

  // Job de nettoyage alertes
  setupAlertCleanupJob() {
    const job = cron.schedule('0 2 * * *', async () => {
      const started = Date.now();
      this.addLog('info', '🧹 Démarrage nettoyage automatique des alertes');

      try {
        console.log('🧹 Démarrage nettoyage automatique des alertes...');
        const deletedCount = await this.alertService.cleanupOldAlerts(30);
        console.log(`✅ Nettoyage alertes terminé: ${deletedCount} alertes supprimées`);
        this.addLog('info', '✅ Nettoyage alertes terminé', { duration_ms: Date.now() - started, deletedCount });
      } catch (error) {
        console.error('❌ Erreur nettoyage alertes:', error.message);
        this.addLog('error', 'Erreur nettoyage alertes', { error: error.message });
      }
    }, {
      scheduled: false
    });
    
    this.jobs.set('alertCleanup', job);
    job.start();
    this.addLog('info', '- Job nettoyage alertes programmé (2h00 tous les jours)');
    console.log('- Job nettoyage alertes programmé (2h00 tous les jours)');
  }

  // Job de nettoyage données
  setupDataCleanupJob() {
    const job = cron.schedule('0 3 * * 0', async () => {
      const started = Date.now();
      this.addLog('info', '🧹 Démarrage nettoyage automatique des données');

      try {
        console.log('🧹 Démarrage nettoyage automatique des données...');
        const cutoffDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
        const result = await SensorData.deleteMany({
          timestamp: { $lt: cutoffDate }
        });
        console.log(`✅ Nettoyage données terminé: ${result.deletedCount} enregistrements supprimés`);
        this.addLog('info', '✅ Nettoyage données terminé', { duration_ms: Date.now() - started, deletedCount: result.deletedCount });
      } catch (error) {
        console.error('❌ Erreur nettoyage données:', error.message);
        this.addLog('error', 'Erreur nettoyage données', { error: error.message });
      }
    }, {
      scheduled: false
    });
    
    this.jobs.set('dataCleanup', job);
    job.start();
    this.addLog('info', '- Job nettoyage données programmé (dimanche 3h00)');
    console.log('- Job nettoyage données programmé (dimanche 3h00)');
  }

  // Job de vérification santé capteurs
  setupHealthCheckJob() {
    const job = cron.schedule('0 * * * *', async () => {
      const started = Date.now();
      this.addLog('info', '🏥 Vérification santé des capteurs démarrée');

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
                severity: 'poor',
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
        this.addLog('info', '✅ Vérification santé capteurs terminée', { duration_ms: Date.now() - started });
        
      } catch (error) {
        console.error('❌ Erreur vérification santé:', error.message);
        this.addLog('error', 'Erreur vérification santé capteurs', { error: error.message });
      }
    }, {
      scheduled: false
    });
    
    this.jobs.set('healthCheck', job);
    job.start();
    this.addLog('info', '- Job vérification santé programmé (toutes les heures)');
    console.log('- Job vérification santé programmé (toutes les heures)');
  }

  // Job de statistiques
  setupStatsJob() {
    const job = cron.schedule('*/5 * * * *', async () => {
      const started = Date.now();

      try {
        const now = new Date();
        const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        
        const alertStats = await Alert.aggregate([
          { $match: { createdAt: { $gte: last24h } } },
          {
            $group: {
              _id: null,
              total: { $sum: 1 },
              active: { $sum: { $cond: ['$isActive', 1, 0] } },
              hazardous: { $sum: { $cond: [{ $eq: ['$severity', 'hazardous'] }, 1, 0] } },
              unhealthy: { $sum: { $cond: [{ $eq: ['$severity', 'unhealthy'] }, 1, 0] } },
              poor: { $sum: { $cond: [{ $eq: ['$severity', 'poor'] }, 1, 0] } },
              moderate: { $sum: { $cond: [{ $eq: ['$severity', 'moderate'] }, 1, 0] } },
              good: { $sum: { $cond: [{ $eq: ['$severity', 'good'] }, 1, 0] } },
              predictive: { $sum: { $cond: [{ $eq: ['$alertType', 'prediction_warning'] }, 1, 0] } },
              weather_related: { $sum: { $cond: [{ $eq: ['$alertType', 'weather_air_quality'] }, 1, 0] } }
            }
          }
        ]);
        
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
        
        let weatherStatus = { available: false };
        try {
          const weatherTest = await this.weatherService.testConnection();
          weatherStatus = {
            available: weatherTest.success,
            cities_configured: this.weatherService.sensorCities.length,
            last_update: new Date()
          };
        } catch (error) {
          console.log('⚠️ Météo indisponible pour stats:', error.message);
          this.addLog('warn', 'Météo indisponible pour stats', { error: error.message });
        }
        
        const systemStats = {
          alerts_24h: alertStats[0] || { 
            total: 0, active: 0, 
            hazardous: 0, unhealthy: 0, poor: 0, moderate: 0, good: 0,
            predictive: 0, weather_related: 0
          },
          sensors: {
            total: sensorStats.length,
            active: sensorStats.filter(s => 
              new Date() - new Date(s.lastUpdate) < 60 * 60 * 1000
            ).length,
            measurements_24h: sensorStats.reduce((sum, s) => sum + s.measurements, 0)
          },
          predictions: predictionStats[0] || { totalPredictions: 0, avgConfidence: 0, futurePredictions: 0 },
          weather: weatherStatus,
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

        this.addLog('info', '📊 Stats diffusées', {
          duration_ms: Date.now() - started,
          alerts_total: systemStats.alerts_24h.total,
          sensors_total: systemStats.sensors.total,
          predictions_total: systemStats.predictions.totalPredictions || 0
        });
        
      } catch (error) {
        console.error('❌ Erreur diffusion stats:', error.message);
        this.addLog('error', 'Erreur diffusion stats', { error: error.message });
      }
    }, {
      scheduled: false
    });
    
    this.jobs.set('stats', job);
    job.start();
    this.addLog('info', '- Job statistiques programmé (toutes les 5 minutes)');
    console.log('- Job statistiques programmé (toutes les 5 minutes)');
  }

  // Vérifier alertes prédictives
  async checkPredictiveAlerts(sensorId, predictions) {
    let alertsCreated = 0;
    
    try {
      for (const prediction of predictions) {
        if (prediction.predictedPM25 > 50 && prediction.confidence > 0.7) {
          const hoursAhead = Math.round((new Date(prediction.predictionFor) - new Date()) / (60 * 60 * 1000));
          
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
      this.addLog('error', 'Erreur alertes prédictives', { sensorId, error: error.message });
    }
    
    return alertsCreated;
  }

  // Diffusions
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
      this.addLog('error', 'Erreur diffusion mise à jour', { error: error.message });
    }
  }

  broadcastWeatherUpdate(weatherData) {
    try {
      if (AlertMiddleware) {
        AlertMiddleware.broadcastSystemStats({
          type: 'weather_update',
          message: 'Données météo mises à jour',
          data: weatherData,
          timestamp: new Date()
        });
      }
    } catch (error) {
      console.error('❌ Erreur diffusion météo:', error.message);
      this.addLog('error', 'Erreur diffusion météo', { error: error.message });
    }
  }

  // Arrêter tous les jobs
  stopAll() {
    console.log('🛑 Arrêt de tous les jobs programmés...');
    this.addLog('warn', 'Arrêt de tous les jobs programmés');
    
    this.jobs.forEach((job, name) => {
      job.stop();
      console.log(`📅 Job "${name}" arrêté`);
      this.addLog('info', 'Job arrêté', { job: name });
    });
    
    this.jobs.clear();
    this.isRunning = false;
    console.log('✅ Tous les jobs ont été arrêtés');
    this.addLog('info', 'Tous les jobs ont été arrêtés');
  }

  // Status des jobs
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

  // Exécution manuelle prédictions
  async runPredictionJobManually() {
    console.log('🔧 Exécution manuelle du job prédictions...');
    this.addLog('info', 'Exécution manuelle du job prédictions');

    try {
      const activeSensors = await SensorData.distinct('sensorId', {
        timestamp: { $gte: new Date(Date.now() - 2 * 60 * 60 * 1000) }
      });
      
      let results = [];
      
      for (const sensorId of activeSensors.slice(0, 3)) {
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
      this.addLog('error', 'Erreur job prédictions manuel', { error: error.message });
      throw error;
    }
  }

  // Exécution manuelle météo
  async runWeatherJobManually() {
    console.log('🔧 Exécution manuelle du job météo...');
    this.addLog('info', 'Exécution manuelle du job météo');

    try {
      const weatherData = await this.weatherService.getWeatherForAllSensorCities();
      
      if (weatherData.success) {
        let alertsCreated = 0;
        
        for (const cityWeather of weatherData.data) {
          if (cityWeather.success) {
            const alerts = await this.checkWeatherAirQualityAlerts(cityWeather.data, cityWeather.city);
            alertsCreated += alerts.length;
          }
        }
        
        return {
          success: true,
          cities_updated: weatherData.summary.successful,
          alerts_created: alertsCreated,
          weather_data: weatherData.data
        };
      } else {
        return {
          success: false,
          error: weatherData.error
        };
      }
      
    } catch (error) {
      console.error('❌ Erreur job météo manuel:', error.message);
      this.addLog('error', 'Erreur job météo manuel', { error: error.message });
      throw error;
    }
  }

  // ✅ NOUVEAU: Test alertes intelligentes
  async runEnhancedAlertsTest() {
    console.log('🎯 Test des alertes intelligentes...');
    this.addLog('info', 'Test des alertes intelligentes');

    try {
      const recentData = await SensorData.find()
        .sort({ timestamp: -1 })
        .limit(10);
      
      if (recentData.length === 0) {
        return {
          success: false,
          message: 'Aucune donnée disponible pour tester'
        };
      }
      
      let totalAlerts = 0;
      const results = [];
      
      for (const data of recentData) {
        try {
          const alerts = await this.enhancedAlertService.analyzeAndCreateAlerts(
            data.sensorId,
            data.location?.name || data.sensorId,
            data.location?.city || 'Dakar',
            data.measurements
          );
          
          if (alerts.length > 0) {
            totalAlerts += alerts.length;
            
            results.push({
              sensorId: data.sensorId,
              location: data.location?.name,
              city: data.location?.city,
              pm25: data.measurements.pm25,
              pm10: data.measurements.pm10,
              co2: data.measurements.co2,
              alerts_created: alerts.length,
              alert_types: alerts.map(a => ({
                type: a.alertType,
                severity: a.severity,
                message: a.message
              }))
            });
            
            alerts.forEach(alert => {
              if (alert._id) {
                triggerAlert(alert);
              }
            });
            
            console.log(`✅ ${alerts.length} alertes intelligentes pour ${data.location?.name || data.sensorId}`);
          }
        } catch (error) {
          console.error(`❌ Erreur test ${data.sensorId}:`, error.message);
          this.addLog('error', 'Erreur test alerte capteur', { 
            sensorId: data.sensorId, 
            error: error.message 
          });
        }
      }
      
      console.log(`🎯 Test terminé: ${totalAlerts} alertes intelligentes créées sur ${recentData.length} capteurs`);
      this.addLog('info', 'Test alertes intelligentes terminé', { 
        totalAlerts, 
        sensorsChecked: recentData.length 
      });
      
      return {
        success: true,
        sensors_checked: recentData.length,
        total_alerts: totalAlerts,
        details: results,
        summary: `${totalAlerts} alertes créées pour ${results.length} capteurs avec données critiques`
      };
      
    } catch (error) {
      console.error('❌ Erreur test alertes intelligentes:', error.message);
      this.addLog('error', 'Erreur test alertes intelligentes', { error: error.message });
      return {
        success: false,
        error: error.message
      };
    }
  }

  // ✅ NOUVEAU: Exécuter manuellement la régénération 168h
  async runWeeklyRegenerationManually() {
    console.log('🔧 Exécution manuelle régénération 168h...');
    this.addLog('info', 'Exécution manuelle régénération 168h');

    try {
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
      const activeSensors = await SensorData.distinct('sensorId', {
        timestamp: { $gte: twoHoursAgo }
      });
      
      const results = {
        total: activeSensors.length,
        upToDate: 0,
        regenerated: 0,
        failed: 0,
        details: []
      };
      
      for (const sensorId of activeSensors) {
        try {
          const now = new Date();
          const futurePredictions = await Prediction.countDocuments({
            sensorId: sensorId,
            predictionFor: { $gt: now }
          });
          
          if (futurePredictions < this.REGENERATION_THRESHOLD) {
            const result = await this.predictionService.generatePrediction(
              sensorId,
              this.PREDICTION_HOURS
            );
            
            if (result.success && result.predictions) {
              results.regenerated++;
              results.details.push({
                sensorId,
                regenerated: true,
                count: result.predictions.length,
                avgPM25: result.avgPM25,
                avgConfidence: result.avgConfidence
              });
            } else {
              results.failed++;
              results.details.push({
                sensorId,
                regenerated: false,
                error: result.message
              });
            }
          } else {
            results.upToDate++;
            results.details.push({
              sensorId,
              skipped: true,
              existingCount: futurePredictions
            });
          }
          
          await new Promise(resolve => setTimeout(resolve, 3000));
          
        } catch (error) {
          results.failed++;
          results.details.push({
            sensorId,
            regenerated: false,
            error: error.message
          });
        }
      }
      
      return {
        success: true,
        message: `Régénération terminée: ${results.regenerated} capteurs mis à jour`,
        results: results
      };
      
    } catch (error) {
      console.error('❌ Erreur régénération manuelle 168h:', error.message);
      this.addLog('error', 'Erreur régénération manuelle 168h', { error: error.message });
      return {
        success: false,
        error: error.message
      };
    }
  }

  // ✅ MODIFIÉ: Exécuter job manuellement
  async runJobManually(jobName) {
    console.log(`🔧 Exécution manuelle du job "${jobName}"...`);
    this.addLog('info', 'Exécution manuelle d\'un job', { jobName });
    
    try {
      switch (jobName) {
        case 'sync':
          return { success: true, message: 'Synchronisation manuelle terminée' };
          
        case 'predictions':
          return await this.runPredictionJobManually();
        
        case 'weekly-regeneration': 
          return await this.runWeeklyRegenerationManually();
          
        case 'weather':
          return await this.runWeatherJobManually();
          
        case 'weatherForecast':
          const forecastResult = await this.weatherService.getWeatherForAllSensorCities();
          return { 
            success: forecastResult.success, 
            message: 'Prévisions météo manuelles terminées',
            data: forecastResult
          };
          
        case 'enhanced-alerts': 
          return await this.runEnhancedAlertsTest();
          
        case 'alertCleanup':
          const deletedAlerts = await this.alertService.cleanupOldAlerts(30);
          return { 
            success: true, 
            message: `${deletedAlerts} alertes nettoyées`,
            deletedCount: deletedAlerts
          };
          
        case 'predictionCleanup':
          const deletedPredictions = await this.predictionService.cleanupOldPredictions(7);
          return { 
            success: true, 
            message: `${deletedPredictions} prédictions nettoyées`,
            deletedCount: deletedPredictions
          };
          
        default:
          throw new Error(`Job "${jobName}" non reconnu`);
      }
      
    } catch (error) {
      console.error(`❌ Erreur job manuel "${jobName}":`, error.message);
      this.addLog('error', 'Erreur job manuel', { jobName, error: error.message });
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Synchronisation complète forcée
  async forceSyncNow() {
    console.log('🔄 Synchronisation complète forcée (capteurs + météo + alertes)...');
    this.addLog('info', 'Synchronisation complète forcée');

    try {
      const results = {
        sensors: null,
        weather: null,
        predictions: null,
        enhanced_alerts: null, // ✅ NOUVEAU
        alerts_created: 0,
        timestamp: new Date()
      };
      
      // 1. Synchronisation capteurs
      try {
        results.sensors = await this.runJobManually('sync');
      } catch (error) {
        results.sensors = { success: false, error: error.message };
      }
      
      // 2. Synchronisation météo
      try {
        results.weather = await this.runJobManually('weather');
        if (results.weather.success) {
          results.alerts_created += results.weather.alerts_created || 0;
        }
      } catch (error) {
        results.weather = { success: false, error: error.message };
      }
      
      // 3. Test alertes intelligentes
      try {
        results.enhanced_alerts = await this.runEnhancedAlertsTest();
        if (results.enhanced_alerts.success) {
          results.alerts_created += results.enhanced_alerts.total_alerts || 0;
        }
      } catch (error) {
        results.enhanced_alerts = { success: false, error: error.message };
      }
      
      // 4. Génération prédictions (optionnel)
      try {
        results.predictions = await this.runPredictionJobManually();
      } catch (error) {
        results.predictions = { success: false, error: error.message };
      }
      
      this.broadcastSystemUpdate();
      if (results.weather && results.weather.success) {
        this.broadcastWeatherUpdate(results.weather);
      }
      
      console.log('✅ Synchronisation complète terminée');
      this.addLog('info', 'Synchronisation complète terminée', { alerts_created: results.alerts_created });
      return results;
      
    } catch (error) {
      console.error('❌ Erreur synchronisation complète:', error.message);
      this.addLog('error', 'Erreur synchronisation complète', { error: error.message });
      throw error;
    }
  }
}


// Instance singleton
const schedulerService = new SchedulerService();

module.exports = schedulerService;