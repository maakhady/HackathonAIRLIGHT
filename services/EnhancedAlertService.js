// services/EnhancedAlertService.js - Système d'alertes intelligent
const Alert = require('../models/Alert');
const SensorData = require('../models/SensorData');

class EnhancedAlertService {
  constructor() {
    // Seuils WHO 2021 et EPA 2024 combinés
    this.thresholds = {
      pm25: {
        good: 12,              // WHO: 0-12 µg/m³
        moderate: 35.4,        // WHO: 12-35.4 µg/m³
        unhealthy_sensitive: 55.4, // EPA: 35.5-55.4 µg/m³
        unhealthy: 150.4,      // EPA: 55.5-150.4 µg/m³
        very_unhealthy: 250.4, // EPA: 150.5-250.4 µg/m³
        hazardous: 500         // EPA: 250.5-500 µg/m³
      },
      pm10: {
        good: 50,
        moderate: 100,
        unhealthy: 250,
        very_unhealthy: 350,
        hazardous: 430
      },
      co2: {
        good: 800,
        moderate: 1000,
        unhealthy: 2000,
        hazardous: 5000
      }
    };
    
    // Zones à risque identifiées (comme Mbeubeuss)
    this.highRiskZones = [
      { name: 'École Médina Gana Sarr, Mbeubeuss', city: 'Keur Massar', reason: 'Proximité décharge' },
      { name: 'Mbeubeuss', city: 'Keur Massar', reason: 'Zone de décharge' }
    ];
  }
  
  /**
   * 🎯 Analyser les données d'un capteur et créer alertes appropriées
   */
  async analyzeAndCreateAlerts(sensorId, sensorName, city, measurements) {
    const alerts = [];
    const { pm25, pm10, co2 } = measurements;
    
    console.log(`🔍 Analyse capteur ${sensorName}: PM2.5=${pm25}, PM10=${pm10}, CO2=${co2}`);
    
    // 1. Détection pics dangereux (>100 µg/m³)
    if (pm25 >= 100) {
      alerts.push(await this.createHazardousPeakAlert(sensorId, sensorName, city, pm25));
    }
    
    // 2. Détection niveaux très élevés (55-100 µg/m³)
    else if (pm25 >= 55) {
      alerts.push(await this.createVeryUnhealthyAlert(sensorId, sensorName, city, pm25));
    }
    
    // 3. Détection niveaux élevés (35-55 µg/m³)
    else if (pm25 >= 35) {
      alerts.push(await this.createUnhealthyAlert(sensorId, sensorName, city, pm25));
    }
    
    // 4. Détection niveaux modérés (12-35 µg/m³)
    else if (pm25 >= 12) {
      alerts.push(await this.createModerateAlert(sensorId, sensorName, city, pm25));
    }
    
    // 5. Détection variation rapide (>50% en moins d'1h)
    const rapidChange = await this.detectRapidChange(sensorId, pm25);
    if (rapidChange) {
      alerts.push(await this.createRapidChangeAlert(sensorId, sensorName, city, rapidChange));
    }
    
    // 6. Alerte spéciale zones à risque (comme Mbeubeuss)
    if (this.isHighRiskZone(sensorName, city) && pm25 >= 50) {
      alerts.push(await this.createHighRiskZoneAlert(sensorId, sensorName, city, pm25));
    }
    
    // 7. Multi-polluants (PM2.5 + PM10 + CO2 élevés)
    if (pm25 >= 35 && pm10 >= 100 && co2 >= 1000) {
      alerts.push(await this.createMultiPollutantAlert(sensorId, sensorName, city, { pm25, pm10, co2 }));
    }
    
    return alerts.filter(Boolean); // Enlever les nulls
  }
  
  /**
   * 🚨 Alerte pic HAZARDOUS (>100 µg/m³) comme à Ziguinchor
   */
  async createHazardousPeakAlert(sensorId, sensorName, city, pm25) {
    try {
      // Vérifier si alerte similaire existe déjà (dernière heure)
      const existingAlert = await Alert.findOne({
        sensorId,
        alertType: 'air_quality_hazardous',
        isActive: true,
        createdAt: { $gte: new Date(Date.now() - 60 * 60 * 1000) }
      });
      
      if (existingAlert) {
        console.log(`⚠️ Alerte hazardous déjà active pour ${sensorName}`);
        return null;
      }
      
      const alert = new Alert({
        sensorId,
        alertType: 'air_quality_hazardous',
        severity: 'hazardous',
        qualityLevel: 'extremely_poor',
        referenceStandard: 'WHO_2021',
        message: `🚨 PIC DANGEREUX: ${sensorName} (${city}) - PM2.5 à ${pm25.toFixed(1)} µg/m³`,
        data: {
          pollutants: {
            pm25: {
              value: pm25,
              unit: 'µg/m³',
              threshold: this.thresholds.pm25.unhealthy,
              standard: 'WHO_2021'
            }
          },
          healthInfo: {
            impact: '⚠️ DANGER IMMÉDIAT - Qualité de l\'air HAZARDOUS',
            recommendations: [
              '🏠 RESTEZ À L\'INTÉRIEUR immédiatement',
              '🚪 Fermez TOUTES les fenêtres et portes',
              '😷 Port du masque FFP2/N95 OBLIGATOIRE si sortie nécessaire',
              '🏃 ANNULEZ toute activité extérieure',
              '💊 Surveillez symptômes respiratoires (toux, difficulté respirer)',
              '🏥 Consultez médecin si symptômes apparaissent'
            ],
            sensitiveGroups: [
              'TOUT LE MONDE est affecté',
              'Risque CRITIQUE pour enfants, personnes âgées, asthmatiques',
              'Danger IMMÉDIAT pour femmes enceintes'
            ],
            symptoms: [
              'Difficulté à respirer',
              'Irritation sévère gorge et yeux',
              'Toux persistante',
              'Fatigue extrême',
              'Oppression thoracique'
            ],
            protectionMeasures: [
              'Purificateur d\'air à PUISSANCE MAXIMALE',
              'Éviter TOUT exercice',
              'Garder enfants à l\'intérieur',
              'Fermer ventilation extérieure'
            ]
          },
          aqiValues: {
            current: this.calculateAQI(pm25),
            who: this.calculateWHOIndex(pm25)
          },
          location: `${sensorName}, ${city}`
        },
        location: {
          type: 'Point',
          coordinates: await this.getCoordinates(sensorId),
          city: city
        },
        tags: ['hazardous', 'health_emergency', 'immediate_action'],
        expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000) // 2h expiration
      });
      
      await alert.save();
      console.log(`🚨 Alerte HAZARDOUS créée: ${sensorName} - PM2.5 ${pm25} µg/m³`);
      return alert;
      
    } catch (error) {
      console.error('❌ Erreur création alerte hazardous:', error.message);
      return null;
    }
  }
  
  /**
   * 🔴 Alerte VERY UNHEALTHY (55-100 µg/m³)
   */
  async createVeryUnhealthyAlert(sensorId, sensorName, city, pm25) {
    try {
      const existingAlert = await Alert.findOne({
        sensorId,
        alertType: 'air_quality_unhealthy',
        severity: { $in: ['unhealthy', 'hazardous'] },
        isActive: true,
        createdAt: { $gte: new Date(Date.now() - 3 * 60 * 60 * 1000) }
      });
      
      if (existingAlert) return null;
      
      const alert = new Alert({
        sensorId,
        alertType: 'air_quality_unhealthy',
        severity: 'unhealthy',
        qualityLevel: 'very_poor',
        referenceStandard: 'WHO_2021',
        message: `🔴 ALERTE SANTÉ: ${sensorName} (${city}) - PM2.5 à ${pm25.toFixed(1)} µg/m³`,
        data: {
          pollutants: {
            pm25: {
              value: pm25,
              unit: 'µg/m³',
              threshold: this.thresholds.pm25.unhealthy_sensitive,
              standard: 'WHO_2021'
            }
          },
          healthInfo: {
            impact: '🔴 Malsain pour TOUS - Action immédiate requise',
            recommendations: [
              '🏠 Limitez le temps à l\'extérieur',
              '😷 Portez un masque si sortie obligatoire',
              '🏃 Évitez tout exercice intensif',
              '🚪 Fermez fenêtres pendant les pics',
              '💨 Utilisez purificateur d\'air si disponible'
            ],
            sensitiveGroups: [
              'Enfants',
              'Personnes âgées',
              'Asthmatiques et maladies respiratoires',
              'Maladies cardiovasculaires',
              'Femmes enceintes'
            ],
            symptoms: [
              'Irritation yeux, nez, gorge',
              'Toux',
              'Essoufflement léger',
              'Fatigue'
            ]
          },
          aqiValues: {
            current: this.calculateAQI(pm25),
            who: this.calculateWHOIndex(pm25)
          },
          location: `${sensorName}, ${city}`
        },
        location: {
          type: 'Point',
          coordinates: await this.getCoordinates(sensorId),
          city: city
        },
        tags: ['unhealthy', 'health_alert', 'avoid_outdoor'],
        expiresAt: new Date(Date.now() + 4 * 60 * 60 * 1000)
      });
      
      await alert.save();
      console.log(`🔴 Alerte UNHEALTHY créée: ${sensorName} - PM2.5 ${pm25} µg/m³`);
      return alert;
      
    } catch (error) {
      console.error('❌ Erreur création alerte unhealthy:', error.message);
      return null;
    }
  }
  
  /**
   * 🟠 Alerte UNHEALTHY FOR SENSITIVE (35-55 µg/m³)
   */
  async createUnhealthyAlert(sensorId, sensorName, city, pm25) {
    try {
      const existingAlert = await Alert.findOne({
        sensorId,
        alertType: 'air_quality_poor',
        severity: { $in: ['poor', 'unhealthy', 'hazardous'] },
        isActive: true,
        createdAt: { $gte: new Date(Date.now() - 6 * 60 * 60 * 1000) }
      });
      
      if (existingAlert) return null;
      
      const alert = new Alert({
        sensorId,
        alertType: 'air_quality_poor',
        severity: 'poor',
        qualityLevel: 'poor',
        referenceStandard: 'WHO_2021',
        message: `🟠 Qualité air DÉGRADÉE: ${sensorName} (${city}) - PM2.5 à ${pm25.toFixed(1)} µg/m³`,
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
            impact: '🟠 Malsain pour groupes sensibles',
            recommendations: [
              '👶 Limitez activités extérieures des enfants',
              '🏃 Réduisez exercices intenses prolongés',
              '😷 Masque recommandé pour personnes sensibles',
              '🪟 Aérez pendant heures moins polluées (matin tôt)'
            ],
            sensitiveGroups: [
              'Enfants en bas âge',
              'Personnes âgées',
              'Asthmatiques',
              'Maladies respiratoires chroniques'
            ]
          },
          aqiValues: {
            current: this.calculateAQI(pm25),
            who: this.calculateWHOIndex(pm25)
          },
          location: `${sensorName}, ${city}`
        },
        location: {
          type: 'Point',
          coordinates: await this.getCoordinates(sensorId),
          city: city
        },
        tags: ['poor', 'sensitive_groups', 'caution'],
        expiresAt: new Date(Date.now() + 6 * 60 * 60 * 1000)
      });
      
      await alert.save();
      console.log(`🟠 Alerte POOR créée: ${sensorName} - PM2.5 ${pm25} µg/m³`);
      return alert;
      
    } catch (error) {
      console.error('❌ Erreur création alerte poor:', error.message);
      return null;
    }
  }
  
  /**
   * 🟡 Alerte MODERATE (12-35 µg/m³)
   */
  async createModerateAlert(sensorId, sensorName, city, pm25) {
    try {
      // Pas d'alerte si déjà une alerte plus grave
      const existingAlert = await Alert.findOne({
        sensorId,
        severity: { $in: ['poor', 'unhealthy', 'hazardous'] },
        isActive: true,
        createdAt: { $gte: new Date(Date.now() - 12 * 60 * 60 * 1000) }
      });
      
      if (existingAlert) return null;
      
      // Alerte moderate seulement si PM2.5 > 25 (vraiment élevé pour moderate)
      if (pm25 < 25) return null;
      
      const alert = new Alert({
        sensorId,
        alertType: 'air_quality_moderate',
        severity: 'moderate',
        qualityLevel: 'moderate',
        referenceStandard: 'WHO_2021',
        message: `🟡 Qualité air MODÉRÉE: ${sensorName} (${city}) - PM2.5 à ${pm25.toFixed(1)} µg/m³`,
        data: {
          pollutants: {
            pm25: {
              value: pm25,
              unit: 'µg/m³',
              threshold: this.thresholds.pm25.good,
              standard: 'WHO_2021'
            }
          },
          healthInfo: {
            impact: '🟡 Acceptable mais attention groupes très sensibles',
            recommendations: [
              '👶 Surveiller enfants asthmatiques',
              '🏃 Réduire exercices très intenses si sensible',
              '🪟 Privilégier aération matin et soir'
            ],
            sensitiveGroups: [
              'Asthmatiques sévères',
              'Jeunes enfants avec problèmes respiratoires'
            ]
          },
          aqiValues: {
            current: this.calculateAQI(pm25),
            who: this.calculateWHOIndex(pm25)
          },
          location: `${sensorName}, ${city}`
        },
        location: {
          type: 'Point',
          coordinates: await this.getCoordinates(sensorId),
          city: city
        },
        tags: ['moderate', 'monitoring'],
        expiresAt: new Date(Date.now() + 12 * 60 * 60 * 1000)
      });
      
      await alert.save();
      console.log(`🟡 Alerte MODERATE créée: ${sensorName} - PM2.5 ${pm25} µg/m³`);
      return alert;
      
    } catch (error) {
      console.error('❌ Erreur création alerte moderate:', error.message);
      return null;
    }
  }
  
  /**
   * ⚡ Détection variation rapide (>50% en <1h)
   */
  async detectRapidChange(sensorId, currentPM25) {
    try {
      // Récupérer mesure d'il y a 1h
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      const previousData = await SensorData.findOne({
        sensorId,
        timestamp: { $gte: oneHourAgo, $lt: new Date(Date.now() - 50 * 60 * 1000) }
      }).sort({ timestamp: -1 });
      
      if (!previousData || !previousData.measurements.pm25) return null;
      
      const previousPM25 = previousData.measurements.pm25;
      const percentChange = Math.abs((currentPM25 - previousPM25) / previousPM25) * 100;
      
      // Variation >50% ET valeur absolue >10 µg/m³
      if (percentChange >= 50 && Math.abs(currentPM25 - previousPM25) >= 10) {
        const direction = currentPM25 > previousPM25 ? 'augmentation' : 'diminution';
        return {
          previousValue: previousPM25,
          currentValue: currentPM25,
          percentChange: percentChange.toFixed(1),
          direction,
          timePeriod: '1 heure'
        };
      }
      
      return null;
      
    } catch (error) {
      console.error('❌ Erreur détection variation rapide:', error.message);
      return null;
    }
  }
  
  /**
   * ⚡ Alerte variation rapide
   */
  async createRapidChangeAlert(sensorId, sensorName, city, changeData) {
    try {
      const { previousValue, currentValue, percentChange, direction } = changeData;
      
      const alert = new Alert({
        sensorId,
        alertType: 'pollution_spike',
        severity: currentValue >= 55 ? 'unhealthy' : currentValue >= 35 ? 'poor' : 'moderate',
        qualityLevel: currentValue >= 55 ? 'very_poor' : currentValue >= 35 ? 'poor' : 'moderate',
        referenceStandard: 'WHO_2021',
        message: `⚡ VARIATION RAPIDE: ${sensorName} (${city}) - ${direction} de ${percentChange}% en 1h (${previousValue.toFixed(1)} → ${currentValue.toFixed(1)} µg/m³)`,
        data: {
          pollutants: {
            pm25: {
              value: currentValue,
              unit: 'µg/m³',
              threshold: this.thresholds.pm25.moderate,
              standard: 'WHO_2021'
            }
          },
          healthInfo: {
            impact: `⚡ ${direction === 'augmentation' ? 'Dégradation rapide' : 'Amélioration rapide'} de la qualité de l'air`,
            recommendations: direction === 'augmentation' ? [
              '⚠️ Pic de pollution en cours',
              '🏠 Rentrez à l\'intérieur si possible',
              '🪟 Fermez fenêtres immédiatement',
              '😷 Portez masque si dehors'
            ] : [
              '✅ Amélioration en cours',
              '🪟 Vous pouvez commencer à aérer',
              '🏃 Conditions deviennent plus favorables'
            ]
          },
          aqiValues: {
            current: this.calculateAQI(currentValue),
            previous: this.calculateAQI(previousValue)
          },
          previousValue: previousValue,
          currentValue: currentValue,
          percentChange: parseFloat(percentChange),
          location: `${sensorName}, ${city}`
        },
        location: {
          type: 'Point',
          coordinates: await this.getCoordinates(sensorId),
          city: city
        },
        tags: ['rapid_change', 'spike', direction],
        expiresAt: new Date(Date.now() + 3 * 60 * 60 * 1000)
      });
      
      await alert.save();
      console.log(`⚡ Alerte variation rapide créée: ${sensorName} - ${direction} ${percentChange}%`);
      return alert;
      
    } catch (error) {
      console.error('❌ Erreur création alerte variation:', error.message);
      return null;
    }
  }
  
  /**
   * 🏭 Alerte zone à haut risque (comme Mbeubeuss)
   */
  async createHighRiskZoneAlert(sensorId, sensorName, city, pm25) {
    try {
      const zone = this.highRiskZones.find(z => 
        sensorName.toLowerCase().includes(z.name.toLowerCase()) ||
        city.toLowerCase() === z.city.toLowerCase()
      );
      
      const alert = new Alert({
        sensorId,
        alertType: 'multi_pollutant',
        severity: pm25 >= 100 ? 'hazardous' : pm25 >= 55 ? 'unhealthy' : 'poor',
        qualityLevel: 'very_poor',
        referenceStandard: 'WHO_2021',
        message: `🏭 ZONE À RISQUE: ${sensorName} (${city}) - ${zone?.reason || 'Zone sensible'} - PM2.5 à ${pm25.toFixed(1)} µg/m³`,
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
            impact: `🏭 Zone à haut risque de pollution - ${zone?.reason || 'Exposition chronique'}`,
            recommendations: [
              '🚨 ÉVITEZ cette zone si possible',
              '😷 Masque OBLIGATOIRE dans cette zone',
              '🏫 Envisager déplacement école/travail si exposition prolongée',
              '🏥 Surveillance santé régulière recommandée',
              '👶 Protégez particulièrement les enfants'
            ],
            sensitiveGroups: [
              'TOUS les résidents de la zone',
              'Travailleurs exposés',
              'Enfants scolarisés à proximité'
            ]
          },
          environmentalContext: {
            urbanPollution: true,
            season: 'dry_season'
          },
          aqiValues: {
            current: this.calculateAQI(pm25)
          },
          location: `${sensorName}, ${city}`,
          riskZone: zone?.name,
          riskReason: zone?.reason
        },
        location: {
          type: 'Point',
          coordinates: await this.getCoordinates(sensorId),
          city: city
        },
        tags: ['high_risk_zone', 'chronic_exposure', zone?.reason?.toLowerCase().replace(/\s/g, '_')],
        expiresAt: new Date(Date.now() + 6 * 60 * 60 * 1000)
      });
      
      await alert.save();
      console.log(`🏭 Alerte zone à risque créée: ${sensorName} - ${zone?.reason}`);
      return alert;
      
    } catch (error) {
      console.error('❌ Erreur création alerte zone risque:', error.message);
      return null;
    }
  }
  
  /**
   * 🔥 Alerte multi-polluants
   */
  async createMultiPollutantAlert(sensorId, sensorName, city, pollutants) {
    try {
      const { pm25, pm10, co2 } = pollutants;
      
      const existingAlert = await Alert.findOne({
        sensorId,
        alertType: 'multi_pollutant',
        isActive: true,
        createdAt: { $gte: new Date(Date.now() - 4 * 60 * 60 * 1000) }
      });
      
      if (existingAlert) return null;
      
      const alert = new Alert({
        sensorId,
        alertType: 'multi_pollutant',
        severity: pm25 >= 55 ? 'unhealthy' : 'poor',
        qualityLevel: 'very_poor',
        referenceStandard: 'WHO_2021',
        message: `🔥 MULTI-POLLUANTS: ${sensorName} (${city}) - PM2.5:${pm25.toFixed(1)}, PM10:${pm10.toFixed(1)}, CO2:${co2.toFixed(0)} ppm`,
        data: {
          pollutants: {
            pm25: {
              value: pm25,
              unit: 'µg/m³',
              threshold: this.thresholds.pm25.moderate,
              standard: 'WHO_2021'
            },
            pm10: {
              value: pm10,
              unit: 'µg/m³',
              threshold: this.thresholds.pm10.moderate,
              standard: 'WHO_2021'
            },
            co2: {
              value: co2,
              unit: 'ppm',
              threshold: this.thresholds.co2.moderate,
              standard: 'ASHRAE'
            }
          },
          healthInfo: {
            impact: '🔥 Pollution combinée - Risque santé accru',
            recommendations: [
              '🏠 Restez à l\'intérieur',
              '💨 Utilisez purificateur d\'air',
              '🪟 Aérez SEULEMENT si qualité extérieure meilleure',
              '😷 Masque recommandé pour sorties',
              '🏃 Évitez tout exercice'
            ]
          },
          elevatedParameters: ['PM2.5', 'PM10', 'CO2'],
          aqiValues: {
            current: this.calculateAQI(pm25)
          },
          location: `${sensorName}, ${city}`
        },
        location: {
          type: 'Point',
          coordinates: await this.getCoordinates(sensorId),
          city: city
        },
        tags: ['multi_pollutant', 'combined_risk'],
        expiresAt: new Date(Date.now() + 4 * 60 * 60 * 1000)
      });
      
      await alert.save();
      console.log(`🔥 Alerte multi-polluants créée: ${sensorName}`);
      return alert;
      
    } catch (error) {
      console.error('❌ Erreur création alerte multi-polluants:', error.message);
      return null;
    }
  }
  
  /**
   * 🎯 Utilitaires
   */
  isHighRiskZone(sensorName, city) {
    return this.highRiskZones.some(zone =>
      sensorName.toLowerCase().includes(zone.name.toLowerCase()) ||
      city.toLowerCase() === zone.city.toLowerCase()
    );
  }
  
  calculateAQI(pm25) {
    if (pm25 <= 12) return Math.round((pm25 / 12) * 50);
    if (pm25 <= 35.4) return Math.round(50 + ((pm25 - 12) / (35.4 - 12)) * 50);
    if (pm25 <= 55.4) return Math.round(100 + ((pm25 - 35.4) / (55.4 - 35.4)) * 50);
    if (pm25 <= 150.4) return Math.round(150 + ((pm25 - 55.4) / (150.4 - 55.4)) * 100);
    if (pm25 <= 250.4) return Math.round(200 + ((pm25 - 150.4) / (250.4 - 150.4)) * 100);
    return Math.round(300 + ((pm25 - 250.4) / (500 - 250.4)) * 200);
  }
  
  calculateWHOIndex(pm25) {
    // Indice WHO: 0-100 basé sur seuils WHO
    if (pm25 <= 12) return Math.round((pm25 / 12) * 50);
    return Math.round(50 + Math.min(((pm25 - 12) / 38) * 50, 50)); // Max 100
  }
  
  async getCoordinates(sensorId) {
    try {
      const latestData = await SensorData.findOne({ sensorId })
        .sort({ timestamp: -1 })
        .select('location.longitude location.latitude');
      
      if (latestData?.location?.longitude && latestData?.location?.latitude) {
        return [latestData.location.longitude, latestData.location.latitude];
      }
      
      return [-17.4467, 14.6928]; // Dakar par défaut
    } catch (error) {
      return [-17.4467, 14.6928];
    }
  }
  
  /**
   * 📊 Statistiques des alertes créées
   */
  async getAlertStats(hours = 24) {
    const startTime = new Date(Date.now() - hours * 60 * 60 * 1000);
    
    const stats = await Alert.aggregate([
      {
        $match: {
          createdAt: { $gte: startTime }
        }
      },
      {
        $group: {
          _id: {
            severity: '$severity',
            alertType: '$alertType'
          },
          count: { $sum: 1 },
          avgPM25: { $avg: '$data.pollutants.pm25.value' }
        }
      },
      {
        $sort: { count: -1 }
      }
    ]);
    
    return stats;
  }
}

module.exports = EnhancedAlertService;