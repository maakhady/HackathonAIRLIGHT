// server.js - Application AirLight complète avec IA et Météo (ROUTES SANS /API)
const express = require('express');
const http = require('http');
const mongoose = require('mongoose');
const cors = require('cors');
const passport = require('passport');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const compression = require('compression');
require('dotenv').config();

// Import des configurations et services
require('./config/passport');
const schedulerService = require('./services/SchedulerService');
const { AlertMiddleware, injectAlertMiddleware } = require('./middleware/alertMiddleware');

//  Import du service météo
const WeatherService = require('./services/WeatherService');

// Import des routes
const authRoutes = require('./routes/auth');
const alertRoutes = require('./routes/alerts');
const sensorRoutes = require('./routes/sensors');
const predictionRoutes = require('./routes/predictions');
const adminRoutes = require('./routes/admin');
const weatherRoutes = require('./routes/weather');

const app = express();
const server = http.createServer(app);

//  Initialiser le service météo
const weatherService = new WeatherService();

// Initialiser AlertMiddleware
AlertMiddleware.initialize(server);

// Middlewares de sécurité et performance
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
    },
  },
}));

app.use(compression());

// Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
  message: {
    success: false,
    message: 'Trop de requêtes, réessayez plus tard'
  }
});

app.use('/api/', limiter);

// Middlewares de base
app.use(express.json({ 
  limit: process.env.MAX_FILE_SIZE ? 
    parseInt(process.env.MAX_FILE_SIZE) : 
    '10mb' 
}));
app.use(express.urlencoded({ extended: true }));

// Configuration CORS
const corsOptions = {
  origin: process.env.CORS_ORIGIN?.split(',') || ['http://localhost:4200','http://localhost:3000'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization']
};
app.use(cors(corsOptions));

// Middleware pour injecter AlertMiddleware
app.use(injectAlertMiddleware);

// Configuration des sessions
app.use(session({
  secret: process.env.SESSION_SECRET || 'votre-session-secret-changez-moi',
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({
    mongoUrl: process.env.MONGODB_URI,
    ttl: 24 * 60 * 60
  }),
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    maxAge: 24 * 60 * 60 * 1000
  }
}));

// Initialisation de Passport
app.use(passport.initialize());
app.use(passport.session());

// Connexion à MongoDB
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/airlight')
  .then(() => {
    console.log(' Connexion MongoDB réussie');
    
    //  Tester le service météo après la connexion DB
    weatherService.testConnection().then(result => {
      if (result.success) {
        console.log('Service météo initialisé avec succès');
      } else {
        console.log(' Service météo non disponible:', result.error);
        if (result.recommendation) {
          console.log(' Recommandation:', result.recommendation);
        }
      }
    });
    
    // Initialiser le scheduler après la connexion DB
    setTimeout(() => {
      schedulerService.initialize();
    }, 2000);
  })
  .catch((error) => {
    console.error(' Erreur connexion MongoDB:', error.message);
  });

// Routes principales SANS préfixe /api (selon votre demande)
app.use('/auth', authRoutes);
app.use('/alerts', alertRoutes);
app.use('/sensors', sensorRoutes);
app.use('/predictions', predictionRoutes);
app.use('/admin', adminRoutes);
app.use('/weather', weatherRoutes); // Routes météo ajoutées

// Route de santé complète avec météo
app.get('/health', async (req, res) => {
  try {
    // Vérifier les services
    const PredictionService = require('./services/PredictionService');
    const predictionService = new PredictionService();
    const aiHealth = await predictionService.checkAIServiceHealth();
    
    //  Vérifier le service météo
    const weatherHealth = await weatherService.testConnection();
    
    const health = {
      status: 'OK',
      timestamp: new Date(),
      services: {
        database: mongoose.connection.readyState === 1 ? 'Connected' : 'Disconnected',
        websocket: AlertMiddleware ? 'Active' : 'Inactive',
        scheduler: schedulerService.isRunning ? 'Running' : 'Stopped',
        ai_service: aiHealth.available ? 'Available' : 'Unavailable',
        weather_service: weatherHealth.success ? 'Available' : 'Unavailable',  
        connectedClients: AlertMiddleware ? AlertMiddleware.getConnectionStats().connectedClients : 0
      },
      scheduler_jobs: schedulerService.getJobsStatus(),
      ai_service_detail: aiHealth,
      weather_service_detail: weatherHealth 
    };
    
    const statusCode = (
      health.services.database === 'Connected' && 
      health.services.scheduler === 'Running'
    ) ? 200 : 503;
    
    res.status(statusCode).json(health);
    
  } catch (error) {
    res.status(503).json({
      status: 'ERROR',
      message: error.message,
      timestamp: new Date()
    });
  }
});

// Route principale avec documentation complète incluant météo
app.get('/', (req, res) => {
  res.json({
    name: 'AirLight API',
    description: 'Système intelligent de surveillance de la qualité de l\'air avec IA prédictive et météo',
    version: '1.0.0',
    features: [
      ' Authentification Google OAuth + JWT',
      ' Système d\'alertes temps réel',
      ' Collecte données multi-capteurs (Sénégal)',
      ' Prédictions IA avec Machine Learning',
      ' Service météo intégré avec corrélation qualité air',  
      ' WebSocket temps réel',
      ' Scheduler automatisé',
      ' Interface administrateur'
    ],
    endpoints: {
      authentication: {
        'POST /auth/register': 'Inscription utilisateur',
        'POST /auth/login': 'Connexion email/password',
        'GET /auth/google': 'Connexion Google OAuth',
        'GET /auth/me': 'Profil utilisateur connecté',
        'POST /auth/logout': 'Déconnexion'
      },
      sensors: {
        'GET /sensors': 'Liste des capteurs avec statuts',
        'GET /sensors/:sensorId/data': 'Données historiques d\'un capteur',
        'GET /sensors/:sensorId/latest': 'Dernières mesures d\'un capteur',
        'GET /sensors/:sensorId/weather': 'Météo pour un capteur spécifique',  
        'GET /sensors/weather/dashboard': 'Dashboard météo tous capteurs',  
        'POST /sensors/data': 'Recevoir données depuis ESP32',
        'POST /sensors/sync': 'Synchroniser avec AirGradient (admin)',
        'GET /sensors/stats/global': 'Statistiques globales tous capteurs'
      },
      alerts: {
        'GET /alerts': 'Liste des alertes avec filtres',
        'GET /alerts/active': 'Alertes actives uniquement',
        'GET /alerts/stats': 'Statistiques des alertes',
        'POST /alerts/check': 'Vérifier et créer alertes',
        'PATCH /alerts/:id/acknowledge': 'Acquitter une alerte',
        'PATCH /alerts/:id/resolve': 'Résoudre une alerte',
        'POST /alerts/bulk/acknowledge': 'Acquitter plusieurs alertes'
      },
      predictions: {
        'GET /predictions/sensors': 'Capteurs avec prédictions disponibles',
        'GET /predictions/:sensorId': 'Prédictions d\'un capteur',
        'POST /predictions/:sensorId/generate': 'Générer nouvelles prédictions',
        'POST /predictions/batch/generate': 'Prédictions tous capteurs (admin)',
        'GET /predictions/:sensorId/accuracy': 'Évaluer précision prédictions',
        'GET /predictions/stats/global': 'Statistiques globales IA',
        'GET /predictions/ai-service/health': 'État du service IA'
      },
      //  Endpoints météo
      weather: {
        'GET /weather/current': 'Météo actuelle (city, lat, lon)',
        'GET /weather/forecast': 'Prévisions météo jusqu\'à 5 jours',
        'GET /weather/cities': 'Météo pour toutes les villes avec capteurs',
        'GET /weather/air-quality-forecast': 'Impact météo sur qualité air',
        'GET /weather/search': 'Recherche de villes',
        'GET /weather/impact/:sensorId': 'Impact météo sur capteur (auth)',
        'GET /weather/dashboard': 'Tableau de bord météo temps réel',
        'GET /weather/stats': 'Statistiques du service météo',
        'GET /weather/test': 'Test connexion API météo (admin)'
      },
      admin: {
        'GET /admin/dashboard': 'Tableau de bord administrateur',
        'GET /admin/scheduler/status': 'État du scheduler',
        'POST /admin/scheduler/run/:jobName': 'Exécuter job manuellement',
        'POST /admin/scheduler/sync-now': 'Synchronisation forcée',
        'GET /admin/users': 'Gestion des utilisateurs',
        'PATCH /admin/users/:id/role': 'Modifier rôle utilisateur'
      },
      system: {
        'GET /health': 'État de santé complet du système',
        'GET /websocket/stats': 'Statistiques connexions WebSocket'
      }
    },
    websocket: {
      url: `ws://localhost:${process.env.PORT || 3000}/socket.io`,
      events: {
        client_to_server: [
          'authenticate - S\'authentifier avec token JWT',
          'subscribe_sensor - S\'abonner aux alertes d\'un capteur',
          'unsubscribe_sensor - Se désabonner d\'un capteur',
          'ping - Test de connexion'
        ],
        server_to_client: [
          'authenticated - Confirmation d\'authentification',
          'new_alert - Nouvelle alerte créée',
          'sensor_alert - Alerte spécifique à un capteur',
          'alert_resolved - Alerte résolue',
          'active_alerts - Liste des alertes actives',
          'system_stats - Statistiques système temps réel',
          'predictions_update - Nouvelles prédictions disponibles',
          'weather_update - Mise à jour météo', 
          'weather_alert - Alerte météo impactant qualité air',
          'pong - Réponse au ping'
        ]
      }
    },
    ai_predictions: {
      service_url: process.env.FLASK_API_URL || 'http://localhost:5000',
      features: [
        'Prédictions PM2.5/AQI jusqu\'à 72h',
        'Machine Learning avec Random Forest',
        'Évaluation automatique de précision',
        'Alertes prédictives intelligentes',
        'Mode dégradé si service IA indisponible'
      ],
      supported_parameters: ['pm25', 'pm10', 'co2', 'temperature', 'humidity', 'tvoc', 'nox']
    },
    //  Nouvelle section météo
    weather_service: {
      provider: 'OpenWeatherMap',
      api_configured: !!process.env.OPENWEATHER_API_KEY,
      features: [
        'Météo temps réel pour toutes les villes du Sénégal',
        'Prévisions jusqu\'à 5 jours',
        'Analyse impact météo sur qualité de l\'air',
        'Corrélation vent/dispersion des polluants',
        'Alertes météo affectant la pollution',
        'Support saison Harmattan',
        'Données en français',
        'Géolocalisation automatique des capteurs'
      ],
      supported_cities: [
        'Dakar', 'Saint-Louis', 'Thiès', 'Diourbel', 
        'Richard-Toll', 'Rufisque', 'Pikine'
      ],
      correlation_factors: [
        'Vitesse et direction du vent (dispersion)',
        'Humidité (suspension particules)',
        'Pression atmosphérique (inversion)',
        'Couverture nuageuse (photo-dégradation)',
        'Saison Harmattan (poussière sahélienne)'
      ]
    },
    sensors_coverage: {
      country: 'Sénégal',
      locations: [
        { name: 'Dakar', status: 'active', weather_available: true },
        { name: 'Saint-Louis', status: 'active', weather_available: true },
        { name: 'Thiès', status: 'active', weather_available: true },
        { name: 'Diourbel', status: 'active', weather_available: true },
        { name: 'Richard Toll', status: 'active', weather_available: true },
        { name: 'Rufisque', status: 'active', weather_available: true }
      ],
      data_sources: ['AirGradient', 'OpenAQ', 'ESP32'],
      weather_integration: 'OpenWeatherMap API' 
    },
    scheduler_jobs: schedulerService.getJobsStatus()
  });
});

// Routes de test pour le développement
if (process.env.NODE_ENV === 'development') {
  // Test complet du système avec météo
  app.post('/test/system', async (req, res) => {
    try {
      const results = {
        timestamp: new Date(),
        tests: {}
      };
      
      // Test base de données
      results.tests.database = {
        status: mongoose.connection.readyState === 1 ? 'OK' : 'FAIL',
        collections: await mongoose.connection.db.listCollections().toArray()
      };
      
      // Test WebSocket
      results.tests.websocket = {
        status: AlertMiddleware ? 'OK' : 'FAIL',
        clients: AlertMiddleware ? AlertMiddleware.getConnectionStats() : null
      };
      
      // Test service IA
      const PredictionService = require('./services/PredictionService');
      const predictionService = new PredictionService();
      const aiHealth = await predictionService.checkAIServiceHealth();
      results.tests.ai_service = aiHealth;
      
      //  Test service météo
      const weatherHealth = await weatherService.testConnection();
      results.tests.weather_service = weatherHealth;
      
      // Test scheduler
      results.tests.scheduler = {
        status: schedulerService.isRunning ? 'OK' : 'FAIL',
        jobs: schedulerService.getJobsStatus()
      };
      
      res.json({
        success: true,
        message: 'Tests système effectués',
        results
      });
      
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Erreur lors des tests système',
        error: error.message
      });
    }
  });
  
  //  Test spécifique météo
  app.post('/test/weather', async (req, res) => {
    try {
      console.log(' Test complet du service météo...');
      
      const weatherTests = {
        connection: await weatherService.testConnection(),
        current_dakar: await weatherService.getCurrentWeather('Dakar'),
        forecast_dakar: await weatherService.getForecast('Dakar', null, null, 3),
        all_cities: await weatherService.getWeatherForAllSensorCities(),
        air_quality_analysis: await weatherService.getAirQualityForecast('Dakar'),
        search_test: await weatherService.searchCity('Thi'),
        stats: weatherService.getServiceStats()
      };
      
      res.json({
        success: true,
        message: ' Tests météo terminés',
        tests: weatherTests
      });
      
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Erreur lors des tests météo',
        error: error.message
      });
    }
  });
  
  // Route pour déclencher une démo complète avec météo
  app.post('/demo/full', async (req, res) => {
    try {
      console.log('🎬 Démarrage démo complète AirLight avec météo...');
      
      const demo_results = {
        step1_data_sync: null,
        step2_weather_sync: null, 
        step3_alert_creation: null,
        step4_prediction_generation: null,
        step5_weather_correlation: null, 
        step6_websocket_broadcast: null
      };
      
      // Étape 1: Synchronisation de données capteurs
      try {
        const syncResult = await schedulerService.runJobManually('sync');
        demo_results.step1_data_sync = { success: true, result: syncResult };
      } catch (error) {
        demo_results.step1_data_sync = { success: false, error: error.message };
      }
      
      // Étape 2: Synchronisation météo
      try {
        const weatherData = await schedulerService.runJobManually('weather');
        demo_results.step2_weather_sync = { success: weatherData.success, result: weatherData };
      } catch (error) {
        demo_results.step2_weather_sync = { success: false, error: error.message };
      }
      
      // Étape 3: Création d'alerte de test
      try {
        const Alert = require('./models/Alert');
        const testAlert = new Alert({
          sensorId: 'DEMO_SENSOR',
          alertType: 'pollution_spike',
          severity: 'unhealthy', //  Corrigé: utiliser nouveaux niveaux
          qualityLevel: 'very_poor',
          referenceStandard: 'WHO_2021',
          message: ' DÉMO - Pic de pollution détecté: PM2.5 à 95.2 µg/m³',
          data: {
            pollutants: {
              pm25: { value: 95.2, unit: 'µg/m³', threshold: 55, standard: 'WHO_2021' }
            },
            healthInfo: {
              impact: 'Malsain pour tous - Action requise',
              recommendations: ['Restez à l\'intérieur', 'Fermez les fenêtres', 'Utilisez un purificateur']
            },
            location: 'Capteur Démo Dakar'
          }
        });
        
        await testAlert.save();
        
        // Diffuser l'alerte
        const { triggerAlert } = require('./middleware/alertMiddleware');
        triggerAlert(testAlert);
        
        demo_results.step3_alert_creation = { success: true, alert: testAlert };
      } catch (error) {
        demo_results.step3_alert_creation = { success: false, error: error.message };
      }
      
      // Étape 4: Génération de prédictions
      try {
        const predResult = await schedulerService.runPredictionJobManually();
        demo_results.step4_prediction_generation = { success: true, result: predResult };
      } catch (error) {
        demo_results.step4_prediction_generation = { success: false, error: error.message };
      }
      
      //  Étape 5: Corrélation météo/qualité air
      try {
        const weatherAnalysis = await weatherService.getAirQualityForecast('Dakar');
        demo_results.step5_weather_correlation = { success: weatherAnalysis.success, result: weatherAnalysis };
      } catch (error) {
        demo_results.step5_weather_correlation = { success: false, error: error.message };
      }
      
      // Étape 6: Diffusion stats WebSocket
      try {
        AlertMiddleware.broadcastSystemStats({
          type: 'demo_complete',
          message: ' Démo AirLight avec météo terminée avec succès',
          demo_results,
          timestamp: new Date()
        });
        
        //  Diffuser aussi update météo
        if (demo_results.step2_weather_sync?.success) {
          schedulerService.broadcastWeatherUpdate({
            type: 'weather_demo',
            message: ' Données météo démo mises à jour',
            data: demo_results.step2_weather_sync.result,
            timestamp: new Date()
          });
        }
        
        demo_results.step6_websocket_broadcast = { success: true };
      } catch (error) {
        demo_results.step6_websocket_broadcast = { success: false, error: error.message };
      }
      
      console.log('🎬 Démo complète avec météo terminée');
      
      res.json({
        success: true,
        message: '🎬 Démo complète AirLight avec météo exécutée',
        demo_results,
        next_steps: [
          '1. Vérifiez les alertes créées dans /alerts',
          '2. Consultez les prédictions dans /predictions/sensors',
          '3. Explorez la météo dans /weather/dashboard',
          '4. Analysez corrélation météo/pollution dans /weather/cities', 
          '5. Observez les stats temps réel via WebSocket',
          '6. Accédez au dashboard admin dans /admin/dashboard'
        ]
      });
      
    } catch (error) {
      console.error(' Erreur démo:', error);
      res.status(500).json({
        success: false,
        message: 'Erreur lors de la démo',
        error: error.message
      });
    }
  });
}

// Gestion des erreurs 404
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route non trouvée',
    suggestion: 'Consultez la documentation sur GET /',
    available_routes: [
      '/auth/*', '/sensors/*', '/alerts/*', 
      '/predictions/*', '/admin/*', '/weather/*', '/health' 
    ]
  });
});

// Middleware de gestion des erreurs globales
app.use((error, req, res, next) => {
  console.error(' Erreur serveur:', error);
  
  // Erreurs de validation MongoDB
  if (error.name === 'ValidationError') {
    return res.status(400).json({
      success: false,
      message: 'Données invalides',
      details: Object.values(error.errors).map(e => e.message)
    });
  }
  
  // Erreurs de cast MongoDB
  if (error.name === 'CastError') {
    return res.status(400).json({
      success: false,
      message: 'Format d\'ID invalide'
    });
  }
  
  // Erreurs JWT
  if (error.name === 'JsonWebTokenError') {
    return res.status(401).json({
      success: false,
      message: 'Token invalide'
    });
  }
  
  // Erreur générique
  res.status(500).json({
    success: false,
    message: process.env.NODE_ENV === 'development' ? error.message : 'Erreur serveur interne'
  });
});

// Gestion de l'arrêt gracieux
process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

function gracefulShutdown(signal) {
  console.log(`\n Signal ${signal} reçu, arrêt gracieux...`);
  
  // Arrêter le scheduler
  schedulerService.stopAll();
  
  // Fermer le serveur
  server.close(async () => {
    console.log(' Serveur HTTP fermé');
    
    // Fermer la connexion MongoDB
    try {
      await mongoose.connection.close();
      console.log(' Connexion MongoDB fermée');
      process.exit(0);
    } catch (err) {
      console.error(' Erreur fermeture MongoDB:', err);
      process.exit(1);
    }
  });
  
  // Forcer l'arrêt après 10 secondes
  setTimeout(() => {
    console.error(' Arrêt forcé après timeout');
    process.exit(1);
  }, 10000);
}
  
  

// Démarrage du serveur
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log('\n =================================');
  console.log(' AirLight API démarrée avec succès');
  console.log(' =================================');
  console.log(` Serveur: http://localhost:${PORT}`);
  console.log(` Google OAuth: ${process.env.GOOGLE_CALLBACK_URL || 'Non configuré'}`);
  console.log(` WebSocket: ws://localhost:${PORT}/socket.io`);
  console.log(` Service IA: ${process.env.FLASK_API_URL || 'http://localhost:5000'}`);
  console.log(` Service météo: ${process.env.OPENWEATHER_API_KEY ? 'OpenWeatherMap configuré' : 'Non configuré'}`); // 🌤️
  console.log(` Dashboard: http://localhost:${PORT}/admin/dashboard`);
  console.log(` Météo: http://localhost:${PORT}/weather/dashboard`); 
  console.log(` Santé: http://localhost:${PORT}/health`);
  
  if (process.env.NODE_ENV === 'development') {
    console.log(` Démo: http://localhost:${PORT}/demo/full`);
    console.log(` Test météo: http://localhost:${PORT}/test/weather`); 
    console.log(' Mode développement - Routes de test disponibles');
  }
  
  console.log(' =================================\n');
});

module.exports = server; 