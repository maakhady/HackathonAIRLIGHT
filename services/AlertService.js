// services/AlertService.js - Service pour gérer les alertes (STANDARDS SANTÉ CORRIGÉS)
const axios = require('axios');
const Alert = require('../models/Alert');

class AlertService {
  constructor() {
    // 🔄 SEUILS CORRIGÉS selon standards OMS 2021 et EPA
    this.thresholds = {
      pm25: {
        moderate: 15,   // ✅ OMS 2021: 15 µg/m³ (au lieu de 25)
        high: 35,       // ✅ EPA: Unhealthy for Sensitive Groups (au lieu de 75)
        critical: 55    // ✅ EPA: Unhealthy for Everyone (au lieu de 150)
      },
      pm10: {
        moderate: 45,   // ✅ OMS 2021: 45 µg/m³ (au lieu de 50)
        high: 75,       // ✅ EPA: Unhealthy for Sensitive Groups (au lieu de 100)
        critical: 150   // ✅ EPA: Unhealthy for Everyone (au lieu de 200)
      },
      co2: {
        moderate: 1000, // Début de préoccupation (maintenu)
        high: 1500,     // Ventilation nécessaire (maintenu)
        critical: 2000  // Action immédiate requise (maintenu)
      }
    };

    // 🆕 Messages santé selon nouveaux standards
    this.healthMessages = {
      pm25: {
        good: "Air excellent - Aucune restriction d'activité",
        moderate: "Air modéré - Acceptable pour la plupart des personnes",
        poor: "Air mauvais - Personnes sensibles peuvent ressentir des symptômes",
        unhealthy: "Air malsain - Tout le monde peut ressentir des effets sur la santé",
        hazardous: "Air dangereux - Avertissement sanitaire d'urgence"
      },
      recommendations: {
        good: ["Profitez des activités extérieures"],
        moderate: ["Activités normales possibles", "Surveillance pour personnes sensibles"],
        poor: ["Limitez les activités extérieures prolongées", "Personnes sensibles : restez à l'intérieur"],
        unhealthy: ["Évitez les activités extérieures", "Fermez les fenêtres", "Utilisez un purificateur d'air"],
        hazardous: ["Restez à l'intérieur", "Portez un masque N95 si sortie nécessaire", "Évitez tout effort physique"]
      }
    };
  }
  
  // Vérifier et créer des alertes pour des données de capteur
  async checkAndCreateAlerts(sensorData) {
    const alerts = [];
    
    try {
      // Validation des données d'entrée
      if (!sensorData || !sensorData.sensorId || !sensorData.measurements) {
        console.warn('⚠️ Données de capteur invalides pour vérification alertes');
        return [];
      }
      
      // Assurer que location existe
      const location = sensorData.location || { name: sensorData.sensorId };
      const measurements = sensorData.measurements;
      
      // Alerte PM2.5 avec nouveaux seuils
      if (measurements.pm25 !== null && measurements.pm25 !== undefined) {
        const pm25Alert = this.checkPM25Alert(sensorData);
        if (pm25Alert) {
          const savedAlert = await this.saveAlert(pm25Alert);
          if (savedAlert) alerts.push(savedAlert);
        }
      }
      
      // Alerte PM10 avec nouveaux seuils
      if (measurements.pm10 !== null && measurements.pm10 !== undefined) {
        const pm10Alert = this.checkPM10Alert(sensorData);
        if (pm10Alert) {
          const savedAlert = await this.saveAlert(pm10Alert);
          if (savedAlert) alerts.push(savedAlert);
        }
      }
      
      // Alerte CO2 (seuils maintenus)
      if (measurements.co2 !== null && measurements.co2 !== undefined) {
        const co2Alert = this.checkCO2Alert(sensorData);
        if (co2Alert) {
          const savedAlert = await this.saveAlert(co2Alert);
          if (savedAlert) alerts.push(savedAlert);
        }
      }
      
      // Alerte combinée pour AQI très élevé
      const combinedAlert = this.checkCombinedAlert(sensorData);
      if (combinedAlert) {
        const savedAlert = await this.saveAlert(combinedAlert);
        if (savedAlert) alerts.push(savedAlert);
      }
      
      // Envoyer alertes physiques pour les alertes critiques
      for (const alert of alerts) {
        if (alert.severity === 'hazardous' || alert.severity === 'unhealthy') {
          await this.sendPhysicalAlert(alert);
        }
      }
      
      return alerts;
      
    } catch (error) {
      console.error('❌ Erreur vérification alertes:', error.message);
      return [];
    }
  }
  
  // 🔄 Vérifier alerte PM2.5 avec nouveaux standards santé
  checkPM25Alert(sensorData) {
    const pm25 = parseFloat(sensorData.measurements.pm25);
    const locationName = sensorData.location?.name || sensorData.sensorId;
    
    if (isNaN(pm25) || pm25 < 0) return null;
    
    // 🚨 CRITIQUE: 55+ µg/m³ (au lieu de 150+)
    if (pm25 >= this.thresholds.pm25.critical) {
      return {
        sensorId: sensorData.sensorId,
        alertType: 'air_quality_hazardous',
        severity: 'hazardous',
        qualityLevel: 'extremely_poor',
        referenceStandard: 'WHO_2021',
        message: `🚨 AIR DANGEREUX: PM2.5 à ${pm25.toFixed(1)} µg/m³ à ${locationName}`,
        data: {
          pollutants: {
            pm25: { 
              value: pm25, 
              unit: 'µg/m³', 
              threshold: this.thresholds.pm25.critical,
              standard: 'WHO_2021'
            }
          },
          healthInfo: {
            impact: this.healthMessages.pm25.hazardous,
            recommendations: this.healthMessages.recommendations.hazardous,
            sensitiveGroups: ['Tout le monde'],
            symptoms: ['Irritation respiratoire sévère', 'Toux', 'Essoufflement'],
            protectionMeasures: ['Masque N95 obligatoire', 'Purificateur d\'air', 'Éviter toute sortie']
          },
          environmentalContext: {
            harmattan: this.isHarmattanSeason(),
            season: this.getCurrentSeason()
          },
          aqiValues: {
            who: this.calculateWHO_AQI(pm25, 'pm25'),
            current: this.calculateWHO_AQI(pm25, 'pm25')
          }
        }
      };
    } 
    // ⚠️ MALSAIN: 35-55 µg/m³ (au lieu de 75-150)
    else if (pm25 >= this.thresholds.pm25.high) {
      return {
        sensorId: sensorData.sensorId,
        alertType: 'air_quality_unhealthy',
        severity: 'unhealthy',
        qualityLevel: 'very_poor',
        referenceStandard: 'WHO_2021',
        message: `🔴 AIR MALSAIN: PM2.5 à ${pm25.toFixed(1)} µg/m³ à ${locationName}`,
        data: {
          pollutants: {
            pm25: { 
              value: pm25, 
              unit: 'µg/m³', 
              threshold: this.thresholds.pm25.high,
              standard: 'WHO_2021'
            }
          },
          healthInfo: {
            impact: this.healthMessages.pm25.unhealthy,
            recommendations: this.healthMessages.recommendations.unhealthy,
            sensitiveGroups: ['Enfants', 'Personnes âgées', 'Asthmatiques', 'Cardiaques'],
            symptoms: ['Irritation respiratoire', 'Toux', 'Gêne thoracique'],
            protectionMeasures: ['Éviter les activités extérieures', 'Fermer les fenêtres', 'Masque recommandé']
          },
          environmentalContext: {
            harmattan: this.isHarmattanSeason(),
            season: this.getCurrentSeason()
          },
          aqiValues: {
            who: this.calculateWHO_AQI(pm25, 'pm25'),
            current: this.calculateWHO_AQI(pm25, 'pm25')
          }
        }
      };
    } 
    // 🟠 MAUVAIS: 15-35 µg/m³ (au lieu de 25-75)
    else if (pm25 >= this.thresholds.pm25.moderate) {
      return {
        sensorId: sensorData.sensorId,
        alertType: 'air_quality_poor',
        severity: 'poor',
        qualityLevel: 'poor',
        referenceStandard: 'WHO_2021',
        message: `🟠 AIR MAUVAIS: PM2.5 à ${pm25.toFixed(1)} µg/m³ à ${locationName}`,
        data: {
          pollutants: {
            pm25: { 
              value: pm25, 
              unit: 'µg/m³', 
              threshold: this.thresholds.pm25.moderate,
              standard: 'WHO_2021'
            }
          },
          healthInfo: {
            impact: this.healthMessages.pm25.poor,
            recommendations: this.healthMessages.recommendations.poor,
            sensitiveGroups: ['Enfants', 'Personnes âgées', 'Asthmatiques'],
            symptoms: ['Léger inconfort respiratoire possible'],
            protectionMeasures: ['Limiter les activités extérieures intenses', 'Surveillance symptômes']
          },
          environmentalContext: {
            harmattan: this.isHarmattanSeason(),
            season: this.getCurrentSeason()
          },
          aqiValues: {
            who: this.calculateWHO_AQI(pm25, 'pm25'),
            current: this.calculateWHO_AQI(pm25, 'pm25')
          }
        }
      };
    }
    
    return null;
  }
  
  // 🔄 Vérifier alerte PM10 avec seuils corrigés
  checkPM10Alert(sensorData) {
    const pm10 = parseFloat(sensorData.measurements.pm10);
    const locationName = sensorData.location?.name || sensorData.sensorId;
    
    if (isNaN(pm10) || pm10 < 0) return null;
    
    if (pm10 >= this.thresholds.pm10.critical) {
      return {
        sensorId: sensorData.sensorId,
        alertType: 'air_quality_hazardous',
        severity: 'hazardous',
        qualityLevel: 'extremely_poor',
        referenceStandard: 'WHO_2021',
        message: `🚨 PM10 DANGEREUX: ${pm10.toFixed(1)} µg/m³ à ${locationName}`,
        data: {
          pollutants: {
            pm10: { 
              value: pm10, 
              unit: 'µg/m³', 
              threshold: this.thresholds.pm10.critical,
              standard: 'WHO_2021'
            }
          },
          healthInfo: {
            impact: 'Dangereux pour tous - Effets graves sur la santé',
            recommendations: ['Restez à l\'intérieur', 'Masque N95 si sortie nécessaire'],
            sensitiveGroups: ['Tout le monde'],
            protectionMeasures: ['Éviter toute activité extérieure']
          }
        }
      };
    } else if (pm10 >= this.thresholds.pm10.high) {
      return {
        sensorId: sensorData.sensorId,
        alertType: 'air_quality_unhealthy',
        severity: 'unhealthy',
        qualityLevel: 'very_poor',
        referenceStandard: 'WHO_2021',
        message: `🔴 PM10 MALSAIN: ${pm10.toFixed(1)} µg/m³ à ${locationName}`,
        data: {
          pollutants: {
            pm10: { 
              value: pm10, 
              unit: 'µg/m³', 
              threshold: this.thresholds.pm10.high,
              standard: 'WHO_2021'
            }
          },
          healthInfo: {
            impact: 'Malsain pour tous, dangereux pour groupes sensibles',
            recommendations: ['Limitez les activités extérieures', 'Fermez les fenêtres'],
            sensitiveGroups: ['Enfants', 'Personnes âgées', 'Asthmatiques']
          }
        }
      };
    } else if (pm10 >= this.thresholds.pm10.moderate) {
      return {
        sensorId: sensorData.sensorId,
        alertType: 'air_quality_poor',
        severity: 'poor',
        qualityLevel: 'poor',
        referenceStandard: 'WHO_2021',
        message: `🟠 PM10 MAUVAIS: ${pm10.toFixed(1)} µg/m³ à ${locationName}`,
        data: {
          pollutants: {
            pm10: { 
              value: pm10, 
              unit: 'µg/m³', 
              threshold: this.thresholds.pm10.moderate,
              standard: 'WHO_2021'
            }
          },
          healthInfo: {
            impact: 'Mauvais pour groupes sensibles',
            recommendations: ['Surveillance pour personnes sensibles'],
            sensitiveGroups: ['Enfants', 'Personnes âgées']
          }
        }
      };
    }
    
    return null;
  }
  
  // Vérifier alerte CO2 (maintenu identique)
  checkCO2Alert(sensorData) {
    const co2 = parseFloat(sensorData.measurements.co2);
    const locationName = sensorData.location?.name || sensorData.sensorId;
    
    if (isNaN(co2) || co2 < 300) return null;
    
    if (co2 > this.thresholds.co2.critical) {
      return {
        sensorId: sensorData.sensorId,
        alertType: 'co2_high',
        severity: 'hazardous',
        qualityLevel: 'extremely_poor',
        message: `💨 CO2 CRITIQUE: ${co2.toFixed(0)} ppm à ${locationName}`,
        data: {
          pollutants: {
            co2: { 
              value: co2, 
              unit: 'ppm', 
              threshold: this.thresholds.co2.critical
            }
          },
          healthInfo: {
            impact: 'Concentration dangereuse - Ventilation immédiate requise',
            recommendations: ['Ouvrez toutes les fenêtres', 'Quittez la pièce si possible'],
            symptoms: ['Somnolence', 'Maux de tête', 'Difficulté de concentration']
          }
        }
      };
    } else if (co2 > this.thresholds.co2.high) {
      return {
        sensorId: sensorData.sensorId,
        alertType: 'co2_high',
        severity: 'poor',
        qualityLevel: 'poor',
        message: `💨 CO2 élevé: ${co2.toFixed(0)} ppm à ${locationName}`,
        data: {
          pollutants: {
            co2: { 
              value: co2, 
              unit: 'ppm', 
              threshold: this.thresholds.co2.high
            }
          },
          healthInfo: {
            impact: 'Amélioration de la ventilation nécessaire',
            recommendations: ['Aérez la pièce', 'Vérifiez la ventilation']
          }
        }
      };
    } else if (co2 > this.thresholds.co2.moderate) {
      return {
        sensorId: sensorData.sensorId,
        alertType: 'co2_high',
        severity: 'moderate',
        qualityLevel: 'moderate',
        message: `🟡 CO2 modéré: ${co2.toFixed(0)} ppm à ${locationName}`,
        data: {
          pollutants: {
            co2: { 
              value: co2, 
              unit: 'ppm', 
              threshold: this.thresholds.co2.moderate
            }
          },
          healthInfo: {
            impact: 'Surveillance recommandée',
            recommendations: ['Vérifiez la ventilation régulièrement']
          }
        }
      };
    }
    
    return null;
  }
  
  // 🔄 Vérifier alerte combinée avec nouveaux seuils
  checkCombinedAlert(sensorData) {
    const measurements = sensorData.measurements;
    const locationName = sensorData.location?.name || sensorData.sensorId;
    
    const pm25 = parseFloat(measurements.pm25) || 0;
    const pm10 = parseFloat(measurements.pm10) || 0;
    const co2 = parseFloat(measurements.co2) || 400;
    
    let elevatedCount = 0;
    let maxSeverity = 'moderate';
    const elevatedParams = [];
    
    // 🔄 Utiliser les nouveaux seuils plus stricts
    if (pm25 >= this.thresholds.pm25.moderate) {
      elevatedCount++;
      elevatedParams.push('PM2.5');
      if (pm25 >= this.thresholds.pm25.critical) maxSeverity = 'hazardous';
      else if (pm25 >= this.thresholds.pm25.high) maxSeverity = 'unhealthy';
      else maxSeverity = 'poor';
    }
    
    if (pm10 >= this.thresholds.pm10.moderate) {
      elevatedCount++;
      elevatedParams.push('PM10');
      if (pm10 >= this.thresholds.pm10.critical && maxSeverity !== 'hazardous') maxSeverity = 'unhealthy';
    }
    
    if (co2 > this.thresholds.co2.moderate) {
      elevatedCount++;
      elevatedParams.push('CO2');
    }
    
    // Créer alerte seulement si 2+ polluants élevés
    if (elevatedCount >= 2) {
      return {
        sensorId: sensorData.sensorId,
        alertType: 'multi_pollutant',
        severity: maxSeverity,
        qualityLevel: maxSeverity === 'hazardous' ? 'extremely_poor' : 'very_poor',
        referenceStandard: 'WHO_2021',
        message: `🌫️ POLLUTION MULTIPLE: ${elevatedParams.join(', ')} élevé(s) à ${locationName}`,
        data: {
          pollutants: {
            pm25: pm25 > 0 ? { value: pm25, unit: 'µg/m³' } : null,
            pm10: pm10 > 0 ? { value: pm10, unit: 'µg/m³' } : null,
            co2: co2 > 400 ? { value: co2, unit: 'ppm' } : null
          },
          healthInfo: {
            impact: 'Pollution atmosphérique multiple - Risques accrus pour la santé',
            recommendations: ['Évitez les activités extérieures prolongées', 'Fermez les fenêtres', 'Utilisez un purificateur d\'air'],
            sensitiveGroups: ['Enfants', 'Personnes âgées', 'Asthmatiques', 'Cardiaques'],
            protectionMeasures: ['Masque recommandé à l\'extérieur', 'Limitez les efforts physiques']
          },
          environmentalContext: {
            harmattan: this.isHarmattanSeason(),
            season: this.getCurrentSeason()
          }
        }
      };
    }
    
    return null;
  }

  // 🆕 Calculer AQI selon standard OMS
  calculateWHO_AQI(value, pollutant) {
    if (pollutant === 'pm25') {
      if (value <= 15) return Math.round((value / 15) * 50);
      if (value <= 35) return Math.round(50 + ((value - 15) / 20) * 50);
      if (value <= 55) return Math.round(100 + ((value - 35) / 20) * 50);
      if (value <= 75) return Math.round(150 + ((value - 55) / 20) * 50);
      return Math.round(200 + ((value - 75) / 50) * 100);
    }
    return 0;
  }

  // 🆕 Déterminer si c'est la saison Harmattan
  isHarmattanSeason() {
    const month = new Date().getMonth(); // 0-11
    return month >= 10 || month <= 2; // Nov-Fév
  }

  // 🆕 Obtenir la saison actuelle
  getCurrentSeason() {
    const month = new Date().getMonth();
    if (month >= 10 || month <= 2) return 'harmattan';
    if (month >= 6 && month <= 9) return 'wet_season'; // 🔧 CORRECTION: wet_season au lieu de rainy_season
    return 'dry_season';
  }
  
  // Sauvegarder une alerte (maintenu identique)
  async saveAlert(alertData) {
    try {
      const recentAlert = await Alert.findOne({
        sensorId: alertData.sensorId,
        alertType: alertData.alertType,
        isActive: true,
        createdAt: { $gte: new Date(Date.now() - 30 * 60 * 1000) }
      });
      
      if (recentAlert) {
        console.log(`ℹ️ Alerte similaire déjà active pour ${alertData.sensorId} (${alertData.alertType})`);
        return recentAlert;
      }
      
      const alert = new Alert(alertData);
      await alert.save();
      
      console.log(`🚨 Alerte créée: ${alertData.severity} - ${alertData.message}`);
      return alert;
      
    } catch (error) {
      console.error('❌ Erreur sauvegarde alerte:', error.message);
      return null;
    }
  }
  
  // Envoyer alerte vers dispositifs physiques
  async sendPhysicalAlert(alertData) {
    try {
      if (!alertData || !alertData.sensorId) {
        console.warn('⚠️ Données d\'alerte invalides pour envoi physique');
        return;
      }
      
      const deviceEndpoint = `http://esp32-${alertData.sensorId}.local/alert`;
      
      const alertPayload = {
        type: alertData.alertType,
        severity: alertData.severity,
        qualityLevel: alertData.qualityLevel,
        message: alertData.message,
        value: alertData.data?.pollutants?.pm25?.value || alertData.data?.currentValue || 0,
        location: alertData.data?.location || alertData.sensorId,
        timestamp: new Date().toISOString(),
        healthImpact: alertData.data?.healthInfo?.impact,
        recommendations: alertData.data?.healthInfo?.recommendations?.slice(0, 2) // Limiter pour ESP32
      };
      
      await axios.post(deviceEndpoint, alertPayload, { 
        timeout: 5000,
        headers: { 'Content-Type': 'application/json' }
      });
      
      console.log(`📡 Alerte physique envoyée vers ${alertData.sensorId}`);
      
      if (alertData._id) {
        await Alert.findByIdAndUpdate(
          alertData._id,
          { 
            $push: { 
              notificationsSent: { 
                type: 'physical', 
                sentAt: new Date() 
              } 
            } 
          }
        );
      }
      
    } catch (error) {
      if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
        console.log(`📡 Dispositif ${alertData.sensorId} non accessible (normal si hors ligne)`);
      } else {
        console.error(`❌ Erreur envoi alerte physique ${alertData.sensorId}:`, error.message);
      }
    }
  }
  
  // Obtenir les alertes actives
  async getActiveAlerts(sensorId = null) {
    try {
      const filter = { isActive: true };
      if (sensorId) filter.sensorId = sensorId;
      
      const alerts = await Alert
        .find(filter)
        .sort({ createdAt: -1 })
        .limit(50);
      
      return alerts;
    } catch (error) {
      console.error('❌ Erreur récupération alertes:', error.message);
      return [];
    }
  }
  
  // Acquitter une alerte
  async acknowledgeAlert(alertId, acknowledgedBy) {
    try {
      const alert = await Alert.findByIdAndUpdate(
        alertId,
        {
          isActive: false,
          acknowledgedBy,
          acknowledgedAt: new Date()
        },
        { new: true }
      );
      
      if (alert) {
        console.log(`✅ Alerte acquittée: ${alertId} par ${acknowledgedBy}`);
      }
      
      return alert;
    } catch (error) {
      console.error('❌ Erreur acquittement alerte:', error.message);
      return null;
    }
  }
  
  // Résoudre une alerte avec raison
  async resolveAlert(alertId, resolvedBy, resolution = 'Résolu automatiquement') {
    try {
      const alert = await Alert.findByIdAndUpdate(
        alertId,
        {
          isActive: false,
          resolvedBy,
          resolvedAt: new Date(),
          resolution
        },
        { new: true }
      );
      
      if (alert) {
        console.log(`✅ Alerte résolue: ${alertId} par ${resolvedBy}`);
      }
      
      return alert;
    } catch (error) {
      console.error('❌ Erreur résolution alerte:', error.message);
      return null;
    }
  }
  
  // Nettoyer les anciennes alertes
  async cleanupOldAlerts(daysOld = 30) {
    try {
      const cutoffDate = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000);
      
      const result = await Alert.deleteMany({
        createdAt: { $lt: cutoffDate },
        isActive: false
      });
      
      console.log(`🧹 ${result.deletedCount} anciennes alertes supprimées`);
      return result.deletedCount;
    } catch (error) {
      console.error('❌ Erreur nettoyage alertes:', error.message);
      return 0;
    }
  }
  
  // 🔄 Obtenir les statistiques avec nouveaux niveaux
  async getAlertStats(hours = 24) {
    try {
      const startTime = new Date(Date.now() - hours * 60 * 60 * 1000);
      
      const stats = await Alert.aggregate([
        {
          $match: {
            createdAt: { $gte: startTime }
          }
        },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            active: { $sum: { $cond: ['$isActive', 1, 0] } },
            hazardous: { $sum: { $cond: [{ $eq: ['$severity', 'hazardous'] }, 1, 0] } },
            unhealthy: { $sum: { $cond: [{ $eq: ['$severity', 'unhealthy'] }, 1, 0] } },
            poor: { $sum: { $cond: [{ $eq: ['$severity', 'poor'] }, 1, 0] } },
            moderate: { $sum: { $cond: [{ $eq: ['$severity', 'moderate'] }, 1, 0] } },
            good: { $sum: { $cond: [{ $eq: ['$severity', 'good'] }, 1, 0] } }
          }
        }
      ]);
      
      return stats[0] || {
        total: 0,
        active: 0,
        hazardous: 0,
        unhealthy: 0,
        poor: 0,
        moderate: 0,
        good: 0
      };
      
    } catch (error) {
      console.error('❌ Erreur stats alertes:', error.message);
      return null;
    }
  }
  
  // Mettre à jour les seuils d'alerte
  updateThresholds(newThresholds) {
    try {
      if (newThresholds.pm25) {
        Object.assign(this.thresholds.pm25, newThresholds.pm25);
      }
      if (newThresholds.pm10) {
        Object.assign(this.thresholds.pm10, newThresholds.pm10);
      }
      if (newThresholds.co2) {
        Object.assign(this.thresholds.co2, newThresholds.co2);
      }
      
      console.log('✅ Seuils d\'alerte mis à jour:', this.thresholds);
      return true;
    } catch (error) {
      console.error('❌ Erreur mise à jour seuils:', error.message);
      return false;
    }
  }
  
  // Obtenir les seuils actuels
  getThresholds() {
    return { 
      ...this.thresholds,
      // 🆕 Ajouter info sur les standards utilisés
      standards: {
        pm25: 'WHO_2021',
        pm10: 'WHO_2021', 
        co2: 'ASHRAE_62.1'
      },
      // 🆕 Seuils en format lisible
      readableThresholds: {
        pm25: {
          excellent: '0-15 µg/m³ (OMS)',
          moderate: '15-35 µg/m³ (OMS)', 
          poor: '35-55 µg/m³ (EPA)',
          unhealthy: '55-75 µg/m³ (EPA)',
          hazardous: '75+ µg/m³ (EPA)'
        },
        pm10: {
          excellent: '0-45 µg/m³ (OMS)',
          moderate: '45-75 µg/m³ (EPA)',
          poor: '75-150 µg/m³ (EPA)', 
          unhealthy: '150+ µg/m³ (EPA)'
        },
        co2: {
          excellent: '400-1000 ppm',
          moderate: '1000-1500 ppm',
          poor: '1500-2000 ppm',
          unhealthy: '2000+ ppm'
        }
      }
    };
  }

  // 🆕 Validation des seuils de santé
  validateHealthThresholds(thresholds) {
    const warnings = [];
    
    // Vérifier PM2.5
    if (thresholds.pm25?.moderate > 20) {
      warnings.push('⚠️ Seuil PM2.5 modéré trop élevé (>20 µg/m³) - Risque pour la santé');
    }
    if (thresholds.pm25?.high > 40) {
      warnings.push('⚠️ Seuil PM2.5 élevé trop permissif (>40 µg/m³) - Non conforme OMS');
    }
    
    // Vérifier PM10  
    if (thresholds.pm10?.moderate > 50) {
      warnings.push('⚠️ Seuil PM10 modéré trop élevé (>50 µg/m³) - Risque pour la santé');
    }
    
    return {
      isValid: warnings.length === 0,
      warnings,
      recommendations: warnings.length > 0 ? [
        'Utilisez les seuils OMS 2021 pour protéger la santé publique',
        'PM2.5: 15/35/55 µg/m³ (modéré/élevé/critique)',
        'PM10: 45/75/150 µg/m³ (modéré/élevé/critique)'
      ] : ['✅ Seuils conformes aux standards de santé internationaux']
    };
  }

  // 🆕 Obtenir recommendations santé selon valeur
  getHealthRecommendations(pollutant, value) {
    const recommendations = {
      pm25: {
        good: ['Profitez des activités extérieures', 'Conditions idéales pour le sport'],
        moderate: ['Activités normales possibles', 'Surveillance pour personnes sensibles'],
        poor: ['Limitez les activités extérieures prolongées', 'Personnes sensibles: restez à l\'intérieur'],
        unhealthy: ['Évitez les activités extérieures', 'Fermez les fenêtres', 'Utilisez un purificateur d\'air'],
        hazardous: ['Restez à l\'intérieur', 'Portez un masque N95 si sortie nécessaire', 'Évitez tout effort physique']
      },
      pm10: {
        good: ['Conditions excellentes pour toutes activités'],
        moderate: ['Activités normales, surveillance pour asthmatiques'],
        poor: ['Limitez les activités extérieures intenses'],
        unhealthy: ['Évitez les activités extérieures', 'Portez un masque'],
        hazardous: ['Restez à l\'intérieur', 'Masque N95 obligatoire']
      },
      co2: {
        good: ['Ventilation adéquate'],
        moderate: ['Aérez régulièrement'],
        poor: ['Améliorez la ventilation', 'Ouvrez les fenêtres'],
        unhealthy: ['Ventilation immédiate requise', 'Quittez la pièce si possible']
      }
    };

    let level = 'good';
    
    if (pollutant === 'pm25') {
      if (value >= 75) level = 'hazardous';
      else if (value >= 55) level = 'unhealthy';
      else if (value >= 35) level = 'poor';
      else if (value >= 15) level = 'moderate';
    } else if (pollutant === 'pm10') {
      if (value >= 150) level = 'hazardous';
      else if (value >= 75) level = 'unhealthy';
      else if (value >= 45) level = 'poor';
      else if (value >= 25) level = 'moderate';
    } else if (pollutant === 'co2') {
      if (value >= 2000) level = 'unhealthy';
      else if (value >= 1500) level = 'poor';
      else if (value >= 1000) level = 'moderate';
    }

    return {
      level,
      recommendations: recommendations[pollutant]?.[level] || ['Données insuffisantes'],
      healthImpact: this.getHealthImpact(pollutant, level),
      sensitiveGroups: this.getSensitiveGroups(level)
    };
  }

  // 🆕 Obtenir impact santé
  getHealthImpact(pollutant, level) {
    const impacts = {
      pm25: {
        good: 'Aucun impact sur la santé',
        moderate: 'Impact minimal sur la santé générale',
        poor: 'Inconfort possible pour personnes sensibles',
        unhealthy: 'Effets sur la santé pour tous, graves pour groupes sensibles',
        hazardous: 'Urgence sanitaire - Effets graves sur la santé'
      },
      pm10: {
        good: 'Conditions excellentes',
        moderate: 'Impact minimal',
        poor: 'Irritation possible des voies respiratoires',
        unhealthy: 'Problèmes respiratoires pour tous',
        hazardous: 'Risques graves pour la santé'
      },
      co2: {
        good: 'Confort optimal',
        moderate: 'Léger inconfort possible',
        poor: 'Somnolence, maux de tête possibles',
        unhealthy: 'Effets significatifs sur la cognition et le confort'
      }
    };

    return impacts[pollutant]?.[level] || 'Impact inconnu';
  }

  // 🆕 Obtenir groupes sensibles
  getSensitiveGroups(level) {
    const groups = {
      good: [],
      moderate: ['Personnes avec asthme sévère'],
      poor: ['Enfants', 'Personnes âgées', 'Asthmatiques'],
      unhealthy: ['Enfants', 'Personnes âgées', 'Asthmatiques', 'Cardiaques', 'Femmes enceintes'],
      hazardous: ['Tout le monde']
    };

    return groups[level] || [];
  }

  // 🆕 Créer rapport qualité air
  async generateAirQualityReport(sensorId, hours = 24) {
    try {
      const startTime = new Date(Date.now() - hours * 60 * 60 * 1000);
      
      const alerts = await Alert.find({
        sensorId,
        createdAt: { $gte: startTime }
      }).sort({ createdAt: -1 });

      const qualityLevels = alerts.map(alert => ({
        time: alert.createdAt,
        level: alert.qualityLevel,
        severity: alert.severity,
        pollutants: alert.data?.pollutants
      }));

      const summary = {
        period: `${hours}h`,
        totalAlerts: alerts.length,
        worstLevel: this.getWorstQualityLevel(alerts),
        mostCommonIssue: this.getMostCommonPollutant(alerts),
        healthAdvice: this.getOverallHealthAdvice(alerts),
        trendAnalysis: this.analyzeTrend(qualityLevels)
      };

      return {
        sensorId,
        summary,
        alerts: alerts.slice(0, 10), // Dernières 10 alertes
        recommendations: this.getContextualRecommendations(summary, sensorId)
      };

    } catch (error) {
      console.error('❌ Erreur génération rapport:', error.message);
      return null;
    }
  }

  // 🆕 Fonctions utilitaires pour le rapport
  getWorstQualityLevel(alerts) {
    const levels = ['good', 'moderate', 'poor', 'unhealthy', 'hazardous'];
    let worst = 'good';
    
    alerts.forEach(alert => {
      const currentIndex = levels.indexOf(alert.severity);
      const worstIndex = levels.indexOf(worst);
      if (currentIndex > worstIndex) worst = alert.severity;
    });
    
    return worst;
  }

  getMostCommonPollutant(alerts) {
    const pollutants = {};
    alerts.forEach(alert => {
      const type = alert.alertType;
      pollutants[type] = (pollutants[type] || 0) + 1;
    });
    
    return Object.keys(pollutants).reduce((a, b) => 
      pollutants[a] > pollutants[b] ? a : b, 'none'
    );
  }

  getOverallHealthAdvice(alerts) {
    const worst = this.getWorstQualityLevel(alerts);
    const advice = {
      good: '✅ Excellente qualité d\'air - Profitez des activités extérieures',
      moderate: '🟡 Qualité d\'air acceptable - Surveillance pour personnes sensibles', 
      poor: '🟠 Qualité d\'air dégradée - Limitez les activités extérieures',
      unhealthy: '🔴 Air malsain - Évitez les sorties, fermez les fenêtres',
      hazardous: '🚨 Air dangereux - Restez à l\'intérieur, masque obligatoire'
    };
    
    return advice[worst] || 'Données insuffisantes';
  }

  analyzeTrend(qualityLevels) {
    if (qualityLevels.length < 2) return 'Données insuffisantes';
    
    const recent = qualityLevels.slice(0, Math.floor(qualityLevels.length / 2));
    const older = qualityLevels.slice(Math.floor(qualityLevels.length / 2));
    
    const recentScore = this.calculateAverageScore(recent);
    const olderScore = this.calculateAverageScore(older);
    
    if (recentScore > olderScore) return '📈 Qualité en dégradation';
    if (recentScore < olderScore) return '📉 Qualité en amélioration'; 
    return '➡️ Qualité stable';
  }

  calculateAverageScore(levels) {
    const scores = { good: 1, moderate: 2, poor: 3, unhealthy: 4, hazardous: 5 };
    const total = levels.reduce((sum, level) => sum + (scores[level.severity] || 0), 0);
    return levels.length > 0 ? total / levels.length : 0;
  }

  getContextualRecommendations(summary, sensorId) {
    const recommendations = [];
    
    if (summary.worstLevel === 'hazardous') {
      recommendations.push('🚨 URGENT: Activez tous les purificateurs d\'air disponibles');
      recommendations.push('📞 Contactez les autorités sanitaires si la situation persiste');
    }
    
    if (this.isHarmattanSeason()) {
      recommendations.push('🌪️ Saison Harmattan: Augmentez la fréquence de nettoyage des filtres');
      recommendations.push('💧 Maintenez une bonne hydratation');
    }
    
    recommendations.push('📊 Surveillez les tendances sur plusieurs jours');
    recommendations.push('🔔 Configurez des alertes pour les niveaux critiques');
    
    return recommendations;
  }
}

module.exports = AlertService;