// routes/alerts.js - Routes pour la gestion des alertes (STANDARDS SANTÉ CORRIGÉS)
const express = require('express');
const AlertService = require('../services/AlertService');
const AuthService = require('../services/AuthService');
const Alert = require('../models/Alert');

const router = express.Router();
const alertService = new AlertService();
const authService = new AuthService();

// GET /alerts - Obtenir toutes les alertes actives
router.get('/', authService.authenticateToken.bind(authService), async (req, res) => {
  try {
    const { sensorId, severity, qualityLevel, limit = 50, offset = 0 } = req.query;
    
    // Construire le filtre avec nouveaux champs
    const filter = { isActive: true };
    if (sensorId) filter.sensorId = sensorId;
    if (severity) filter.severity = severity;
    if (qualityLevel) filter.qualityLevel = qualityLevel; // 🆕 Nouveau filtre
    
    const alerts = await Alert
      .find(filter)
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip(parseInt(offset));
    
    const totalCount = await Alert.countDocuments(filter);
    
    res.json({
      success: true,
      data: alerts,
      pagination: {
        total: totalCount,
        limit: parseInt(limit),
        offset: parseInt(offset),
        hasMore: totalCount > parseInt(offset) + parseInt(limit)
      },
      // 🆕 Ajouter info sur les standards utilisés
      healthStandards: {
        reference: 'WHO_2021',
        lastUpdate: new Date().toISOString()
      }
    });
    
  } catch (error) {
    console.error('❌ Erreur récupération alertes:', error.message);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération des alertes'
    });
  }
});

// GET /alerts/active - Obtenir les alertes actives pour un capteur
router.get('/active', authService.authenticateToken.bind(authService), async (req, res) => {
  try {
    const { sensorId } = req.query;
    const alerts = await alertService.getActiveAlerts(sensorId);
    
    res.json({
      success: true,
      data: alerts,
      count: alerts.length,
      // 🆕 Ajouter résumé qualité air
      airQualitySummary: alerts.length > 0 ? {
        worstLevel: Math.max(...alerts.map(a => ['good', 'moderate', 'poor', 'unhealthy', 'hazardous'].indexOf(a.severity))),
        hasHealthAlert: alerts.some(a => ['unhealthy', 'hazardous'].includes(a.severity)),
        recommendations: alerts.length > 0 ? alerts[0].data?.healthInfo?.recommendations?.slice(0, 2) : []
      } : null
    });
    
  } catch (error) {
    console.error('❌ Erreur alertes actives:', error.message);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération des alertes actives'
    });
  }
});

// 🔄 GET /alerts/stats - Statistiques avec nouveaux niveaux de santé
router.get('/stats', authService.authenticateToken.bind(authService), async (req, res) => {
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
    
    // 🔄 Agrégations avec nouveaux niveaux de sévérité
    const stats = await Alert.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate }
        }
      },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          active: { $sum: { $cond: ['$isActive', 1, 0] } },
          // 🆕 Nouveaux niveaux de santé
          hazardous: { $sum: { $cond: [{ $eq: ['$severity', 'hazardous'] }, 1, 0] } },
          unhealthy: { $sum: { $cond: [{ $eq: ['$severity', 'unhealthy'] }, 1, 0] } },
          poor: { $sum: { $cond: [{ $eq: ['$severity', 'poor'] }, 1, 0] } },
          moderate: { $sum: { $cond: [{ $eq: ['$severity', 'moderate'] }, 1, 0] } },
          good: { $sum: { $cond: [{ $eq: ['$severity', 'good'] }, 1, 0] } },
          // 🔄 Garder anciens pour compatibilité
          critical: { $sum: { $cond: [{ $eq: ['$severity', 'critical'] }, 1, 0] } },
          high: { $sum: { $cond: [{ $eq: ['$severity', 'high'] }, 1, 0] } },
          medium: { $sum: { $cond: [{ $eq: ['$severity', 'medium'] }, 1, 0] } },
          low: { $sum: { $cond: [{ $eq: ['$severity', 'low'] }, 1, 0] } }
        }
      }
    ]);

    // 🆕 Stats par niveau de qualité air
    const qualityStats = await Alert.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate }
        }
      },
      {
        $group: {
          _id: '$qualityLevel',
          count: { $sum: 1 }
        }
      },
      {
        $sort: { count: -1 }
      }
    ]);
    
    // Stats par type d'alerte
    const typeStats = await Alert.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate }
        }
      },
      {
        $group: {
          _id: '$alertType',
          count: { $sum: 1 }
        }
      },
      {
        $sort: { count: -1 }
      }
    ]);
    
    // Stats par capteur
    const sensorStats = await Alert.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate }
        }
      },
      {
        $group: {
          _id: '$sensorId',
          count: { $sum: 1 },
          activeCount: { $sum: { $cond: ['$isActive', 1, 0] } },
          worstSeverity: { $max: '$severity' }
        }
      },
      {
        $sort: { count: -1 }
      },
      {
        $limit: 10
      }
    ]);

    // 🆕 Stats de santé publique
    const healthImpactStats = await Alert.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate },
          'data.healthInfo.impact': { $exists: true }
        }
      },
      {
        $group: {
          _id: '$data.healthInfo.impact',
          count: { $sum: 1 }
        }
      },
      {
        $sort: { count: -1 }
      }
    ]);
    
    const summaryData = stats[0] || {
      total: 0,
      active: 0,
      hazardous: 0,
      unhealthy: 0,
      poor: 0,
      moderate: 0,
      good: 0,
      critical: 0,
      high: 0,
      medium: 0,
      low: 0
    };

    // 🆕 Calcul du niveau de risque global
    const globalRiskLevel = this.calculateGlobalRisk(summaryData);
    
    res.json({
      success: true,
      period,
      data: {
        summary: summaryData,
        byQuality: qualityStats,
        byType: typeStats,
        bySensor: sensorStats,
        healthImpact: healthImpactStats,
        // 🆕 Nouveaux indicateurs de santé
        healthIndicators: {
          globalRisk: globalRiskLevel,
          criticalAlertsRatio: summaryData.total > 0 ? 
            ((summaryData.hazardous + summaryData.unhealthy) / summaryData.total * 100).toFixed(1) + '%' : '0%',
          activeHealthAlerts: summaryData.hazardous + summaryData.unhealthy,
          recommendation: this.getGlobalRecommendation(globalRiskLevel)
        }
      },
      // 🆕 Métadonnées standards
      standards: {
        reference: 'WHO_2021',
        pm25Thresholds: '15/35/55 µg/m³',
        pm10Thresholds: '45/75/150 µg/m³',
        lastUpdate: new Date().toISOString()
      }
    });
    
  } catch (error) {
    console.error('❌ Erreur stats alertes:', error.message);
    res.status(500).json({
      success: false,
      message: 'Erreur lors du calcul des statistiques'
    });
  }
});

// Fonctions utilitaires pour les stats
router.calculateGlobalRisk = function(stats) {
  if (stats.hazardous > 0) return 'hazardous';
  if (stats.unhealthy > 0) return 'unhealthy';
  if (stats.poor > 0) return 'poor';
  if (stats.moderate > 0) return 'moderate';
  return 'good';
};

router.getGlobalRecommendation = function(riskLevel) {
  const recommendations = {
    good: '✅ Conditions excellentes - Profitez des activités extérieures',
    moderate: '🟡 Surveillance pour personnes sensibles',
    poor: '🟠 Limitez les activités extérieures prolongées',
    unhealthy: '🔴 Évitez les sorties - Fermez les fenêtres',
    hazardous: '🚨 Restez à l\'intérieur - Masque obligatoire'
  };
  return recommendations[riskLevel] || 'Données insuffisantes';
};

// 🆕 GET /alerts/thresholds - Obtenir les seuils avec validation santé
router.get('/thresholds', authService.authenticateToken.bind(authService), async (req, res) => {
  try {
    const thresholds = alertService.getThresholds();
    
    // 🆕 Validation des seuils de santé
    const validation = alertService.validateHealthThresholds(thresholds);
    
    res.json({
      success: true,
      data: thresholds,
      validation, // 🆕 Info validation
      message: 'Seuils d\'alerte actuels avec validation santé'
    });
    
  } catch (error) {
    console.error('❌ Erreur récupération seuils:', error.message);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération des seuils'
    });
  }
});

// 🔄 PUT /alerts/thresholds - Modifier avec validation santé renforcée
router.put('/thresholds', authService.requireAdmin.bind(authService), async (req, res) => {
  try {
    const { pm25, pm10, co2 } = req.body;
    
    if (!pm25 && !pm10 && !co2) {
      return res.status(400).json({
        success: false,
        message: 'Au moins un type de seuil (pm25, pm10, co2) doit être fourni'
      });
    }

    // 🆕 Validation renforcée des seuils de santé
    const validation = alertService.validateHealthThresholds(req.body);
    
    if (!validation.isValid) {
      return res.status(400).json({
        success: false,
        message: 'Seuils non conformes aux standards de santé',
        warnings: validation.warnings,
        recommendations: validation.recommendations
      });
    }
    
    const success = alertService.updateThresholds(req.body);
    
    if (success) {
      res.json({
        success: true,
        message: 'Seuils d\'alerte mis à jour avec succès',
        newThresholds: alertService.getThresholds(),
        validation // 🆕 Confirmation validation
      });
    } else {
      res.status(500).json({
        success: false,
        message: 'Erreur lors de la mise à jour des seuils'
      });
    }
    
  } catch (error) {
    console.error('❌ Erreur mise à jour seuils:', error.message);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la mise à jour des seuils'
    });
  }
});

// GET /alerts/stats/quick - Statistiques rapides avec nouveaux niveaux
router.get('/stats/quick', async (req, res) => {
  try {
    const { hours = 24 } = req.query;
    const stats = await alertService.getAlertStats(parseInt(hours));
    
    if (stats) {
      res.json({
        success: true,
        data: stats,
        period: `${hours}h`,
        // 🆕 Indicateur de santé rapide
        healthStatus: {
          level: stats.hazardous > 0 ? 'hazardous' : 
                 stats.unhealthy > 0 ? 'unhealthy' :
                 stats.poor > 0 ? 'poor' : 'acceptable',
          activeHealthAlerts: (stats.hazardous || 0) + (stats.unhealthy || 0)
        }
      });
    } else {
      res.status(500).json({
        success: false,
        message: 'Erreur lors du calcul des statistiques'
      });
    }
    
  } catch (error) {
    console.error('❌ Erreur stats rapides:', error.message);
    res.status(500).json({
      success: false,
      message: 'Erreur lors du calcul des statistiques rapides'
    });
  }
});

// GET /alerts/:id - Obtenir une alerte avec détails santé
router.get('/:id', authService.authenticateToken.bind(authService), async (req, res) => {
  try {
    const alert = await Alert.findById(req.params.id);
    
    if (!alert) {
      return res.status(404).json({
        success: false,
        message: 'Alerte non trouvée'
      });
    }

    // 🆕 Enrichir avec recommandations contextuelles
    let enrichedAlert = alert.toObject();
    
    if (alert.data?.pollutants?.pm25) {
      const healthReco = alertService.getHealthRecommendations('pm25', alert.data.pollutants.pm25.value);
      enrichedAlert.contextualRecommendations = healthReco;
    }
    
    res.json({
      success: true,
      data: enrichedAlert
    });
    
  } catch (error) {
    console.error('❌ Erreur récupération alerte:', error.message);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération de l\'alerte'
    });
  }
});

// POST /alerts/check - Vérifier avec nouveaux standards
router.post('/check', authService.authenticateToken.bind(authService), async (req, res) => {
  try {
    const sensorData = req.body;
    
    if (!sensorData.sensorId || !sensorData.measurements) {
      return res.status(400).json({
        success: false,
        message: 'Données de capteur invalides - sensorId et measurements requis'
      });
    }
    
    const alerts = await alertService.checkAndCreateAlerts(sensorData);
    
    // 🆕 Ajouter contexte santé
    const healthContext = {
      worstLevel: alerts.length > 0 ? 
        Math.max(...alerts.map(a => ['good', 'moderate', 'poor', 'unhealthy', 'hazardous'].indexOf(a.severity))) : 0,
      hasUrgentAlert: alerts.some(a => ['unhealthy', 'hazardous'].includes(a.severity)),
      recommendations: alerts.length > 0 && alerts[0].data?.healthInfo?.recommendations ? 
        alerts[0].data.healthInfo.recommendations.slice(0, 3) : []
    };
    
    res.json({
      success: true,
      message: `${alerts.length} alerte(s) créée(s)`,
      data: alerts,
      alertsCreated: alerts.length,
      healthContext // 🆕 Contexte santé
    });
    
  } catch (error) {
    console.error('❌ Erreur vérification alertes:', error.message);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la vérification des alertes'
    });
  }
});

// 🔄 POST /alerts/manual - Créer avec nouveaux types et validation
router.post('/manual', authService.requireAdmin.bind(authService), async (req, res) => {
  try {
    const { sensorId, alertType, severity, qualityLevel, message, data } = req.body;
    
    if (!sensorId || !alertType || !severity || !message) {
      return res.status(400).json({
        success: false,
        message: 'Champs requis manquants: sensorId, alertType, severity, message'
      });
    }
    
    // 🔄 Validation avec nouveaux niveaux
    const validSeverities = ['good', 'moderate', 'poor', 'unhealthy', 'hazardous'];
    const validQualityLevels = ['excellent', 'good', 'moderate', 'poor', 'very_poor', 'extremely_poor'];
    const validAlertTypes = [
      'air_quality_good', 'air_quality_moderate', 'air_quality_poor', 
      'air_quality_unhealthy', 'air_quality_hazardous',
      'pollution_spike', 'co2_high', 'multi_pollutant', 
      'sensor_offline', 'maintenance_required'
    ];
    
    if (!validSeverities.includes(severity)) {
      return res.status(400).json({
        success: false,
        message: `Sévérité invalide. Valeurs autorisées: ${validSeverities.join(', ')}`
      });
    }
    
    if (qualityLevel && !validQualityLevels.includes(qualityLevel)) {
      return res.status(400).json({
        success: false,
        message: `Niveau de qualité invalide. Valeurs autorisées: ${validQualityLevels.join(', ')}`
      });
    }
    
    if (!validAlertTypes.includes(alertType)) {
      return res.status(400).json({
        success: false,
        message: `Type d'alerte invalide. Valeurs autorisées: ${validAlertTypes.join(', ')}`
      });
    }
    
    const alertData = {
      sensorId,
      alertType,
      severity,
      qualityLevel: qualityLevel || severity, // 🆕 Défaut intelligent
      referenceStandard: 'WHO_2021', // 🆕 Standard par défaut
      message,
      data: data || {},
      createdBy: req.user.id
    };
    
    const alert = await alertService.saveAlert(alertData);
    
    if (alert) {
      res.status(201).json({
        success: true,
        message: 'Alerte manuelle créée avec succès',
        data: alert
      });
    } else {
      res.status(500).json({
        success: false,
        message: 'Erreur lors de la création de l\'alerte'
      });
    }
    
  } catch (error) {
    console.error('❌ Erreur création alerte manuelle:', error.message);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la création de l\'alerte manuelle'
    });
  }
});

// PATCH /alerts/:id/acknowledge - Maintenu identique
router.patch('/:id/acknowledge', authService.authenticateToken.bind(authService), async (req, res) => {
  try {
    const alertId = req.params.id;
    const acknowledgedBy = req.userId;
    
    const alert = await alertService.acknowledgeAlert(alertId, acknowledgedBy);
    
    if (alert) {
      res.json({
        success: true,
        message: 'Alerte acquittée avec succès',
        data: alert
      });
    } else {
      res.status(404).json({
        success: false,
        message: 'Alerte non trouvée'
      });
    }
    
  } catch (error) {
    console.error('❌ Erreur acquittement alerte:', error.message);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de l\'acquittement'
    });
  }
});

// PATCH /alerts/:id/resolve - Maintenu identique
router.patch('/:id/resolve', authService.authenticateToken.bind(authService), async (req, res) => {
  try {
    const alertId = req.params.id;
    const { resolution } = req.body;
    const resolvedBy = req.userId;
    
    const alert = await alertService.resolveAlert(
      alertId, 
      resolvedBy, 
      resolution || 'Résolu manuellement'
    );
    
    if (alert) {
      res.json({
        success: true,
        message: 'Alerte marquée comme résolue',
        data: alert
      });
    } else {
      res.status(404).json({
        success: false,
        message: 'Alerte non trouvée'
      });
    }
    
  } catch (error) {
    console.error('❌ Erreur résolution alerte:', error.message);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la résolution'
    });
  }
});

// POST /alerts/bulk/acknowledge - Maintenu identique
router.post('/bulk/acknowledge', authService.authenticateToken.bind(authService), async (req, res) => {
  try {
    const { alertIds } = req.body;
    const acknowledgedBy = req.userId;
    
    if (!Array.isArray(alertIds) || alertIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Liste d\'alertes invalide - array d\'IDs requis'
      });
    }
    
    const result = await Alert.updateMany(
      { _id: { $in: alertIds }, isActive: true },
      {
        isActive: false,
        acknowledgedBy,
        acknowledgedAt: new Date()
      }
    );
    
    res.json({
      success: true,
      message: `${result.modifiedCount} alerte(s) acquittée(s)`,
      modifiedCount: result.modifiedCount,
      totalRequested: alertIds.length
    });
    
  } catch (error) {
    console.error('❌ Erreur acquittement multiple:', error.message);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de l\'acquittement multiple'
    });
  }
});

// POST /alerts/bulk/resolve - Maintenu identique
router.post('/bulk/resolve', authService.authenticateToken.bind(authService), async (req, res) => {
  try {
    const { alertIds, resolution } = req.body;
    const resolvedBy = req.userId;
    
    if (!Array.isArray(alertIds) || alertIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Liste d\'alertes invalide - array d\'IDs requis'
      });
    }
    
    const result = await Alert.updateMany(
      { _id: { $in: alertIds }, isActive: true },
      {
        isActive: false,
        resolvedBy,
        resolvedAt: new Date(),
        resolution: resolution || 'Résolution en lot'
      }
    );
    
    res.json({
      success: true,
      message: `${result.modifiedCount} alerte(s) résolue(s)`,
      modifiedCount: result.modifiedCount,
      totalRequested: alertIds.length
    });
    
  } catch (error) {
    console.error('❌ Erreur résolution multiple:', error.message);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la résolution multiple'
    });
  }
});

// DELETE /alerts/cleanup - Maintenu identique
router.delete('/cleanup', authService.requireAdmin.bind(authService), async (req, res) => {
  try {
    const { daysOld = 30 } = req.query;
    const deletedCount = await alertService.cleanupOldAlerts(parseInt(daysOld));
    
    res.json({
      success: true,
      message: `${deletedCount} ancienne(s) alerte(s) supprimée(s)`,
      deletedCount,
      cutoffDays: parseInt(daysOld)
    });
    
  } catch (error) {
    console.error('❌ Erreur nettoyage alertes:', error.message);
    res.status(500).json({
      success: false,
      message: 'Erreur lors du nettoyage'
    });
  }
});

// GET /alerts/history/:sensorId - Avec enrichissement santé
router.get('/history/:sensorId', authService.authenticateToken.bind(authService), async (req, res) => {
  try {
    const { sensorId } = req.params;
    const { limit = 20, offset = 0, severity, qualityLevel } = req.query;
    
    const filter = { sensorId };
    if (severity) filter.severity = severity;
    if (qualityLevel) filter.qualityLevel = qualityLevel; // 🆕 Nouveau filtre
    
    const alerts = await Alert
      .find(filter)
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip(parseInt(offset))
      .lean();
    
    const totalCount = await Alert.countDocuments(filter);

    // 🆕 Analyse de tendance santé
    const healthTrend = alerts.length > 1 ? 
      alertService.analyzeTrend(alerts.map(a => ({
        time: a.createdAt,
        severity: a.severity,
        qualityLevel: a.qualityLevel
      }))) : 'Données insuffisantes';
    
    res.json({
      success: true,
      data: alerts,
      pagination: {
        total: totalCount,
        limit: parseInt(limit),
        offset: parseInt(offset),
        hasMore: totalCount > parseInt(offset) + parseInt(limit)
      },
      sensorId,
      // 🆕 Analyse de l'historique
      analysis: {
        healthTrend,
        mostCommonLevel: alerts.length > 0 ? 
          alerts.reduce((a, b) => alerts.filter(v => v.severity === a).length >= 
                               alerts.filter(v => v.severity === b).length ? a : b).severity : null,
        averageAQI: alerts.filter(a => a.data?.aqiValues?.current).length > 0 ?
          (alerts.filter(a => a.data?.aqiValues?.current)
                  .reduce((sum, a) => sum + a.data.aqiValues.current, 0) / 
           alerts.filter(a => a.data?.aqiValues?.current).length).toFixed(1) : null
      }
    });
    
  } catch (error) {
    console.error('❌ Erreur historique alertes:', error.message);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération de l\'historique'
    });
  }
});

// 🆕 GET /alerts/report/:sensorId - Nouveau: Rapport qualité air
router.get('/report/:sensorId', authService.authenticateToken.bind(authService), async (req, res) => {
  try {
    const { sensorId } = req.params;
    const { hours = 24 } = req.query;
    
    const report = await alertService.generateAirQualityReport(sensorId, parseInt(hours));
    
    if (report) {
      res.json({
        success: true,
        data: report,
        message: `Rapport qualité air généré pour ${sensorId}`
      });
    } else {
      res.status(500).json({
        success: false,
        message: 'Erreur lors de la génération du rapport'
      });
    }
    
  } catch (error) {
    console.error('❌ Erreur génération rapport:', error.message);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la génération du rapport'
    });
  }
});

// 🆕 GET /alerts/health-recommendations - Obtenir recommandations santé
router.get('/health-recommendations', authService.authenticateToken.bind(authService), async (req, res) => {
  try {
    const { pollutant, value } = req.query;
    
    if (!pollutant || !value) {
      return res.status(400).json({
        success: false,
        message: 'Paramètres pollutant et value requis'
      });
    }
    
    const recommendations = alertService.getHealthRecommendations(pollutant, parseFloat(value));
    
    res.json({
      success: true,
      data: recommendations,
      pollutant,
      value: parseFloat(value)
    });
    
  } catch (error) {
    console.error('❌ Erreur recommandations santé:', error.message);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération des recommandations'
    });
  }
});

// 🆕 POST /alerts/validate-thresholds - Valider des seuils avant application
router.post('/validate-thresholds', authService.requireAdmin.bind(authService), async (req, res) => {
  try {
    const validation = alertService.validateHealthThresholds(req.body);
    
    res.json({
      success: true,
      validation,
      message: validation.isValid ? 
        'Seuils conformes aux standards de santé' : 
        'Seuils non conformes - Voir les avertissements'
    });
    
  } catch (error) {
    console.error('❌ Erreur validation seuils:', error.message);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la validation'
    });
  }
});

// 🔄 POST /alerts/test - Tests avec nouveaux standards santé
if (process.env.NODE_ENV === 'development') {
  router.post('/test', authService.requireAdmin.bind(authService), async (req, res) => {
    try {
      const { testType = 'basic', sensorId = 'TEST_SENSOR_001' } = req.body;
      
      let testData;
      
      switch (testType) {
        case 'hazardous':
          testData = {
            sensorId,
            location: { name: 'Capteur Test Dangereux' },
            measurements: {
              pm25: 85,   // 🔄 HAZARDOUS selon nouveaux seuils (au lieu de 180)
              pm10: 160,  // 🔄 HAZARDOUS selon nouveaux seuils
              co2: 2500,  // CRITIQUE (maintenu)
              temperature: 28,
              humidity: 65
            }
          };
          break;
          
        case 'unhealthy':
          testData = {
            sensorId,
            location: { name: 'Capteur Test Malsain' },
            measurements: {
              pm25: 65,   // 🔄 UNHEALTHY selon nouveaux seuils (au lieu de 80)
              pm10: 85,   // 🔄 UNHEALTHY selon nouveaux seuils
              co2: 1600,  // Élevé (maintenu)
              temperature: 30,
              humidity: 45
            }
          };
          break;

        case 'poor':
          testData = {
            sensorId,
            location: { name: 'Capteur Test Mauvais' },
            measurements: {
              pm25: 45,   // 🔄 POOR selon nouveaux seuils
              pm10: 60,   // 🔄 POOR selon nouveaux seuils
              co2: 1200,  // Modéré
              temperature: 25,
              humidity: 60
            }
          };
          break;

        case 'moderate':
          testData = {
            sensorId,
            location: { name: 'Capteur Test Modéré' },
            measurements: {
              pm25: 25,   // 🔄 MODERATE selon nouveaux seuils
              pm10: 50,   // 🔄 MODERATE selon nouveaux seuils  
              co2: 900,   // Bon
              temperature: 22,
              humidity: 55
            }
          };
          break;

        case 'good':
          testData = {
            sensorId,
            location: { name: 'Capteur Test Excellent' },
            measurements: {
              pm25: 10,   // 🔄 GOOD selon nouveaux seuils
              pm10: 30,   // 🔄 GOOD selon nouveaux seuils
              co2: 450,   // Excellent
              temperature: 20,
              humidity: 50
            }
          };
          break;
          
        default: // basic - test avec seuils réalistes
          testData = {
            sensorId,
            location: { name: 'Capteur Test Basique' },
            measurements: {
              pm25: 40,   // 🔄 POOR selon nouveaux seuils (au lieu de 85)
              pm10: 65,   // 🔄 POOR selon nouveaux seuils
              co2: 800,   // Normal
              temperature: 25,
              humidity: 60
            }
          };
      }
      
      const alerts = await alertService.checkAndCreateAlerts(testData);
      
      // 🆕 Analyse détaillée du test
      const testAnalysis = {
        expectedAlerts: this.getExpectedAlerts(testType),
        actualAlerts: alerts.length,
        healthLevels: alerts.map(a => a.severity),
        worstLevel: alerts.length > 0 ? 
          Math.max(...alerts.map(a => ['good', 'moderate', 'poor', 'unhealthy', 'hazardous'].indexOf(a.severity))) : 0,
        recommendations: alerts.length > 0 && alerts[0].data?.healthInfo?.recommendations ? 
          alerts[0].data.healthInfo.recommendations : []
      };
      
      res.json({
        success: true,
        message: `Test d'alerte effectué (${testType}) avec standards OMS 2021`,
        testData,
        alertsCreated: alerts,
        alertCount: alerts.length,
        testType,
        analysis: testAnalysis,
        // 🆕 Info sur les nouveaux standards
        healthStandards: {
          reference: 'WHO_2021',
          pm25NewThresholds: '15/35/55 µg/m³ (moderate/unhealthy/hazardous)',
          pm10NewThresholds: '45/75/150 µg/m³ (moderate/unhealthy/hazardous)',
          improvement: 'Seuils plus stricts = Meilleure protection santé'
        }
      });
      
    } catch (error) {
      console.error('❌ Erreur test alerte:', error.message);
      res.status(500).json({
        success: false,
        message: 'Erreur lors du test'
      });
    }
  });

  // Fonction utilitaire pour les tests
  router.getExpectedAlerts = function(testType) {
    const expected = {
      good: 0,
      moderate: 1,
      poor: 2,
      unhealthy: 2,
      hazardous: 3,
      basic: 2
    };
    return expected[testType] || 1;
  };

  // 🆕 GET /alerts/test/compare-standards - Comparer anciens vs nouveaux seuils
  router.get('/test/compare-standards', authService.requireAdmin.bind(authService), async (req, res) => {
    try {
      const testValues = [
        { pm25: 20, pm10: 40, label: 'Valeur faible' },
        { pm25: 40, pm10: 70, label: 'Valeur moyenne' },
        { pm25: 60, pm10: 100, label: 'Valeur élevée' },
        { pm25: 80, pm10: 150, label: 'Valeur très élevée' }
      ];

      const comparison = testValues.map(test => {
        // Anciens seuils (dangereux)
        const oldPM25Level = test.pm25 > 150 ? 'critical' : 
                            test.pm25 > 75 ? 'high' : 
                            test.pm25 > 25 ? 'medium' : 'low';
        
        // Nouveaux seuils OMS 2021 (protecteurs)
        const newPM25Level = test.pm25 >= 55 ? 'hazardous' :
                            test.pm25 >= 35 ? 'unhealthy' :
                            test.pm25 >= 15 ? 'poor' : 'good';

        return {
          ...test,
          oldClassification: oldPM25Level,
          newClassification: newPM25Level,
          healthImprovement: this.getHealthImprovement(oldPM25Level, newPM25Level)
        };
      });

      res.json({
        success: true,
        message: 'Comparaison standards anciens vs OMS 2021',
        data: comparison,
        summary: {
          improvement: 'Les nouveaux seuils OMS 2021 détectent les risques santé plus tôt',
          protection: 'Meilleure protection des groupes sensibles (enfants, personnes âgées)',
          recommendation: 'Migration immédiate recommandée pour la santé publique'
        }
      });

    } catch (error) {
      console.error('❌ Erreur comparaison standards:', error.message);
      res.status(500).json({
        success: false,
        message: 'Erreur lors de la comparaison'
      });
    }
  });

  router.getHealthImprovement = function(oldLevel, newLevel) {
    const improvements = {
      'low->good': '✅ Classification appropriée maintenue',
      'low->poor': '⚠️ Détection précoce du risque santé',
      'medium->poor': '⚠️ Meilleure identification des risques',
      'medium->unhealthy': '🔴 Alerte santé critique maintenant détectée',
      'high->unhealthy': '🔴 Classification santé plus appropriée',
      'high->hazardous': '🚨 Urgence santé maintenant identifiée',
      'critical->hazardous': '🚨 Niveau de danger approprié'
    };
    
    return improvements[`${oldLevel}->${newLevel}`] || '📈 Amélioration de la protection santé';
  };
}

// 🆕 GET /alerts/dashboard/health - Tableau de bord santé temps réel
router.get('/dashboard/health', async (req, res) => {
  try {
    const { period = '1h' } = req.query;
    
    let hours;
    switch (period) {
      case '1h': hours = 1; break;
      case '6h': hours = 6; break;
      case '24h': hours = 24; break;
      default: hours = 1;
    }

    const startTime = new Date(Date.now() - hours * 60 * 60 * 1000);
    
    // Alertes actives par niveau de santé
    const activeAlerts = await Alert.find({
      isActive: true,
      createdAt: { $gte: startTime }
    }).sort({ createdAt: -1 });

    // Analyse globale de la qualité de l'air
    const healthDashboard = {
      timestamp: new Date().toISOString(),
      period: `${hours}h`,
      globalStatus: {
        level: 'good',
        activeAlerts: activeAlerts.length,
        criticalSensors: 0,
        healthyAirRatio: '0%'
      },
      byHealthLevel: {
        hazardous: activeAlerts.filter(a => a.severity === 'hazardous').length,
        unhealthy: activeAlerts.filter(a => a.severity === 'unhealthy').length,
        poor: activeAlerts.filter(a => a.severity === 'poor').length,
        moderate: activeAlerts.filter(a => a.severity === 'moderate').length,
        good: activeAlerts.filter(a => a.severity === 'good').length
      },
      recommendations: [],
      sensitiveGroupsAlert: false,
      airQualityTrend: 'stable'
    };

    // Déterminer le statut global
    if (healthDashboard.byHealthLevel.hazardous > 0) {
      healthDashboard.globalStatus.level = 'hazardous';
      healthDashboard.sensitiveGroupsAlert = true;
      healthDashboard.recommendations = [
        '🚨 Urgence sanitaire - Restez à l\'intérieur',
        '😷 Masque N95 obligatoire si sortie nécessaire',
        '🏠 Fermez toutes les fenêtres'
      ];
    } else if (healthDashboard.byHealthLevel.unhealthy > 0) {
      healthDashboard.globalStatus.level = 'unhealthy';
      healthDashboard.sensitiveGroupsAlert = true;
      healthDashboard.recommendations = [
        '🔴 Évitez les activités extérieures',
        '👥 Groupes sensibles: restez à l\'intérieur',
        '🌬️ Utilisez un purificateur d\'air'
      ];
    } else if (healthDashboard.byHealthLevel.poor > 0) {
      healthDashboard.globalStatus.level = 'poor';
      healthDashboard.sensitiveGroupsAlert = true;
      healthDashboard.recommendations = [
        '🟠 Limitez les activités extérieures prolongées',
        '👶 Surveillance renforcée pour enfants et personnes âgées'
      ];
    } else if (healthDashboard.byHealthLevel.moderate > 0) {
      healthDashboard.globalStatus.level = 'moderate';
      healthDashboard.recommendations = [
        '🟡 Air acceptable pour la plupart',
        '⚠️ Surveillance pour personnes très sensibles'
      ];
    } else {
      healthDashboard.recommendations = [
        '✅ Excellente qualité d\'air',
        '🏃‍♂️ Conditions idéales pour toutes activités'
      ];
    }

    // Capteurs critiques
    healthDashboard.globalStatus.criticalSensors = 
      healthDashboard.byHealthLevel.hazardous + healthDashboard.byHealthLevel.unhealthy;

    // Ratio air sain
    const totalAlerts = activeAlerts.length;
    const healthyAlerts = healthDashboard.byHealthLevel.good + healthDashboard.byHealthLevel.moderate;
    healthDashboard.globalStatus.healthyAirRatio = totalAlerts > 0 ? 
      `${Math.round((healthyAlerts / totalAlerts) * 100)}%` : '100%';

    res.json({
      success: true,
      data: healthDashboard,
      standards: {
        reference: 'WHO_2021',
        lastUpdate: '2024-08-13',
        note: 'Seuils conformes aux recommandations OMS pour la protection de la santé publique'
      }
    });

  } catch (error) {
    console.error('❌ Erreur dashboard santé:', error.message);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la génération du dashboard santé'
    });
  }
});

module.exports = router;