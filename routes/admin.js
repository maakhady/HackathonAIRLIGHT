// routes/admin.js - Routes d'administration
const express = require('express');
const AuthService = require('../services/AuthService');
const schedulerService = require('../services/SchedulerService');
const { AlertMiddleware } = require('../middleware/alertMiddleware');
const SensorData = require('../models/SensorData');
const Alert = require('../models/Alert');
const User = require('../models/User');

// ✅ AJOUTER CES IMPORTS
const TriWeeklyReportService = require('../services/TriWeeklyReportService');
const { sendTriWeeklyReport } = require('../config/email');

const router = express.Router();
const authService = new AuthService();

// Middleware pour vérifier les droits admin sur toutes les routes
router.use(authService.requireAdmin.bind(authService));

// ✅ AJOUTER CETTE FONCTION (alias pour le middleware)
const isAdmin = authService.requireAdmin.bind(authService);

// GET /admin/dashboard - Tableau de bord administrateur
router.get('/dashboard', async (req, res) => {
  try {
    const now = new Date();
    const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const last7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    
    // Statistiques générales
    const [userCount, alertCount24h, sensorDataCount24h, totalAlerts] = await Promise.all([
      User.countDocuments({ isActive: true }),
      Alert.countDocuments({ createdAt: { $gte: last24h } }),
      SensorData.countDocuments({ timestamp: { $gte: last24h } }),
      Alert.countDocuments()
    ]);
    
    // Statistiques des capteurs
    const sensorStats = await SensorData.aggregate([
      {
        $match: { timestamp: { $gte: last24h } }
      },
      {
        $group: {
          _id: '$sensorId',
          measurements: { $sum: 1 },
          avgAQI: { $avg: '$airQualityIndex' },
          lastUpdate: { $max: '$timestamp' }
        }
      },
      {
        $sort: { measurements: -1 }
      }
    ]);
    
    // Alertes par sévérité
    const alertsBySeverity = await Alert.aggregate([
      {
        $match: { createdAt: { $gte: last7d } }
      },
      {
        $group: {
          _id: '$severity',
          count: { $sum: 1 }
        }
      }
    ]);
    
    // État du scheduler
    const schedulerStatus = schedulerService.getJobsStatus();
    
    // Statistiques WebSocket
    const websocketStats = AlertMiddleware.getConnectionStats();
    
    res.json({
      success: true,
      data: {
        overview: {
          users: userCount,
          alerts_24h: alertCount24h,
          sensor_data_24h: sensorDataCount24h,
          total_alerts: totalAlerts,
          active_sensors: sensorStats.filter(s => 
            new Date() - new Date(s.lastUpdate) < 60 * 60 * 1000
          ).length
        },
        sensors: sensorStats,
        alerts: {
          bySeverity: alertsBySeverity,
          recent: await Alert.find({ createdAt: { $gte: last24h } })
            .sort({ createdAt: -1 })
            .limit(10)
        },
        scheduler: schedulerStatus,
        websocket: websocketStats,
        system: {
          uptime: process.uptime(),
          memory: process.memoryUsage(),
          nodeVersion: process.version,
          environment: process.env.NODE_ENV
        }
      }
    });
    
  } catch (error) {
    console.error('Erreur dashboard admin:', error.message);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération du dashboard'
    });
  }
});

// ✅ ROUTE : Envoyer rapport tri-hebdomadaire à tous les abonnés
router.post('/send-triweekly-report', async (req, res) => {
  try {
    const result = await TriWeeklyReportService.generateAndSendReports();
    res.json({
      success: true,
      message: `Rapport envoyé à ${result.successful}/${result.total} utilisateurs`,
      data: result
    });
  } catch (error) {
    console.error('Erreur envoi rapport:', error);
    res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
});

// ✅ ROUTE : Test email rapport (sans auth admin requise pour faciliter le test)
router.post('/test-email-report', async (req, res) => {
  try {
    const testEmail = req.body.email || 'makhadypro@gmail.com';
    
    const reportData = {
      userEmail: testEmail,
      userName: 'Mame Khady',
      userCity: 'Dakar',
      period: '30/01 - 02/02/2026',
      daysCount: 3,
      avgAqi: 68,
      bestDay: { date: '30/01', aqi: 42 },
      worstDay: { date: '01/02', aqi: 89 },
      trendPercentage: -12,
      alertsCount: 3,
      topCities: [
        { name: 'Saint-Louis', aqi: 32 },
        { name: 'Ziguinchor', aqi: 38 },
        { name: 'Thiès', aqi: 45 },
        { name: 'Diourbel', aqi: 62 },
        { name: 'Dakar', aqi: 68 }
      ],
      userCityRank: { position: 5, total: 5 },
      cigaretteEquivalent: 0.8,
      unhealthyHours: 18,
      predictions: [
        { day: 'Aujourd\'hui', aqi: 52 },
        { day: 'Demain', aqi: 38 },
        { day: 'Après-demain', aqi: 45 }
      ],
      bestPredictionDay: {
        message: 'Conditions favorables demain grâce aux vents océaniques',
        bestTime: 'Demain 6h-9h'
      },
      recommendations: [
        { icon: '✅', text: 'Sport outdoor OK vendredi matin' },
        { icon: '⚠️', text: 'Limiter sorties mercredi après-midi' },
        { icon: '🏠', text: 'Aérer maison tôt le matin' }
      ],
      tip: {
        title: '🌿 Les plantes purifient l\'air',
        content: 'L\'Aloe Vera, le Ficus et la Sansevieria peuvent réduire la pollution intérieure jusqu\'à 10%. Trouvables facilement au marché Sandaga à Dakar.'
      }
    };

    const result = await sendTriWeeklyReport(testEmail, reportData);

    res.json({
      success: true,
      message: `Email test envoyé à ${testEmail}`,
      result
    });
  } catch (error) {
    console.error('Erreur test email:', error);
    res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
});

// GET /admin/scheduler/status - État du scheduler
router.get('/scheduler/status', (req, res) => {
  try {
    const status = schedulerService.getJobsStatus();
    res.json({
      success: true,
      data: status
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Erreur récupération statut scheduler'
    });
  }
});

// POST /admin/scheduler/run/:jobName - Exécuter un job manuellement
router.post('/scheduler/run/:jobName', async (req, res) => {
  try {
    const { jobName } = req.params;
    const result = await schedulerService.runJobManually(jobName);
    
    res.json({
      success: result,
      message: result ? 
        `Job "${jobName}" exécuté avec succès` : 
        `Erreur lors de l'exécution du job "${jobName}"`
    });
    
  } catch (error) {
    console.error('Erreur exécution job:', error.message);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de l\'exécution du job'
    });
  }
});

// POST /admin/scheduler/restart/:jobName - Redémarrer un job
router.post('/scheduler/restart/:jobName', (req, res) => {
  try {
    const { jobName } = req.params;
    const result = schedulerService.restartJob(jobName);
    
    res.json({
      success: result,
      message: result ? 
        `Job "${jobName}" redémarré` : 
        `Job "${jobName}" non trouvé`
    });
    
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Erreur lors du redémarrage du job'
    });
  }
});

// POST /admin/scheduler/sync-now - Forcer une synchronisation immédiate
router.post('/scheduler/sync-now', async (req, res) => {
  try {
    const result = await schedulerService.forceSyncNow();
    res.json({
      success: true,
      message: 'Synchronisation forcée terminée',
      data: result
    });
  } catch (error) {
    console.error('Erreur sync forcée:', error.message);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la synchronisation forcée'
    });
  }
});

// PUT /admin/alerts/thresholds - Mettre à jour les seuils d'alerte
router.put('/alerts/thresholds', (req, res) => {
  try {
    const { thresholds } = req.body;
    
    if (!thresholds) {
      return res.status(400).json({
        success: false,
        message: 'Seuils requis'
      });
    }
    
    const result = schedulerService.updateAlertThresholds(thresholds);
    
    res.json({
      success: result,
      message: result ? 
        'Seuils d\'alerte mis à jour' : 
        'Erreur lors de la mise à jour des seuils'
    });
    
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la mise à jour des seuils'
    });
  }
});

// GET /admin/users - Liste des utilisateurs
router.get('/users', async (req, res) => {
  try {
    const { page = 1, limit = 50, search, role } = req.query;
    
    const filter = {};
    if (search) {
      filter.$or = [
        { firstName: { $regex: search, $options: 'i' } },
        { lastName: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ];
    }
    if (role) {
      filter.role = role;
    }
    
    const users = await User.find(filter)
      .select('-password -resetPasswordToken')
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip((parseInt(page) - 1) * parseInt(limit));
    
    const totalCount = await User.countDocuments(filter);
    
    res.json({
      success: true,
      data: users,
      pagination: {
        total: totalCount,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(totalCount / parseInt(limit))
      }
    });
    
  } catch (error) {
    console.error('Erreur liste utilisateurs:', error.message);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération des utilisateurs'
    });
  }
});

// PATCH /admin/users/:id/role - Changer le rôle d'un utilisateur
router.patch('/users/:id/role', async (req, res) => {
  try {
    const { id } = req.params;
    const { role } = req.body;
    
    if (!['admin', 'user'].includes(role)) {
      return res.status(400).json({
        success: false,
        message: 'Rôle invalide'
      });
    }
    
    const user = await User.findByIdAndUpdate(
      id,
      { role },
      { new: true }
    ).select('-password');
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Utilisateur non trouvé'
      });
    }
    
    res.json({
      success: true,
      message: 'Rôle utilisateur mis à jour',
      data: user
    });
    
  } catch (error) {
    console.error('Erreur mise à jour rôle:', error.message);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la mise à jour du rôle'
    });
  }
});

// DELETE /admin/users/:id - Désactiver un utilisateur
router.delete('/users/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Ne pas permettre de se supprimer soi-même
    if (id === req.user.id) {
      return res.status(400).json({
        success: false,
        message: 'Impossible de désactiver votre propre compte'
      });
    }
    
    const user = await User.findByIdAndUpdate(
      id,
      { isActive: false },
      { new: true }
    ).select('-password');
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Utilisateur non trouvé'
      });
    }
    
    res.json({
      success: true,
      message: 'Utilisateur désactivé',
      data: user
    });
    
  } catch (error) {
    console.error('Erreur désactivation utilisateur:', error.message);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la désactivation'
    });
  }
});

// PATCH /admin/users/:id/reactivate - Réactiver un utilisateur
router.patch('/users/:id/reactivate', async (req, res) => {
  try {
    const { id } = req.params;

    if (id === req.user.id) {
      return res.status(400).json({
        success: false,
        message: 'Impossible de réactiver votre propre compte'
      });
    }

    const user = await User.findByIdAndUpdate(
      id,
      { isActive: true },
      { new: true }
    ).select('-password');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Utilisateur non trouvé'
      });
    }

    res.json({
      success: true,
      message: 'Utilisateur réactivé',
      data: user
    });
  } catch (error) {
    console.error('Erreur réactivation utilisateur:', error.message);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la réactivation'
    });
  }
});

// GET /admin/logs/scheduler - Logs du scheduler
router.get('/logs/scheduler', (req, res) => {
  try {
    const logs = schedulerService.getExecutionLogs();
    res.json({
      success: true,
      data: logs
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Erreur récupération logs'
    });
  }
});

// POST /admin/maintenance/cleanup - Nettoyage général
router.post('/maintenance/cleanup', async (req, res) => {
  try {
    const { alerts = true, data = false, daysOld = 30 } = req.body;
    const results = {};
    
    if (alerts) {
      const alertResult = await schedulerService.runJobManually('alertCleanup');
      results.alerts = alertResult;
    }
    
    if (data) {
      const dataResult = await schedulerService.runJobManually('dataCleanup');
      results.data = dataResult;
    }
    
    res.json({
      success: true,
      message: 'Nettoyage terminé',
      results
    });
    
  } catch (error) {
    console.error('Erreur nettoyage:', error.message);
    res.status(500).json({
      success: false,
      message: 'Erreur lors du nettoyage'
    });
  }
});

// GET /admin/websocket/clients - Clients WebSocket connectés
router.get('/websocket/clients', (req, res) => {
  try {
    const stats = AlertMiddleware.getConnectionStats();
    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Erreur récupération clients WebSocket'
    });
  }
});

module.exports = router;