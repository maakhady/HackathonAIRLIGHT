const moment = require('moment');
const User = require('../models/User');
const SensorData = require('../models/SensorData');
const Prediction = require('../models/Prediction');
const { sendTriWeeklyReport } = require('../config/email');

class TriWeeklyReportService {

  async generateAndSendReports() {
  try {
    console.log('\n📊 ===== GÉNÉRATION RAPPORT TRI-HEBDOMADAIRE =====');
    console.log(`📅 Date: ${moment().format('DD/MM/YYYY HH:mm')}`);

    // ✅ ADAPTER À TON MODÈLE
    const subscribers = await User.find({
      'notifications.email': true,  // ← Au lieu de emailNotifications
      isActive: true
    });

    console.log(`👥 ${subscribers.length} utilisateurs abonnés`);

    if (subscribers.length === 0) {
      console.log('⚠️ Aucun utilisateur abonné');
      return { successful: 0, total: 0 };
    }

    const results = await Promise.allSettled(
      subscribers.map(user => this.generateAndSendForUser(user))
    );

    const successful = results.filter(r => r.status === 'fulfilled' && r.value.success).length;
    console.log(`\n✅ ${successful}/${subscribers.length} rapports envoyés avec succès`);
    console.log('===== FIN GÉNÉRATION RAPPORT =====\n');

    return { successful, total: subscribers.length };

  } catch (error) {
    console.error('❌ Erreur génération rapport:', error);
    throw error;
  }
}

  async generateAndSendToEmail(email) {
    const user = await User.findOne({ email, isActive: true });
    if (!user) throw new Error(`Utilisateur introuvable ou inactif : ${email}`);
    return this.generateAndSendForUser(user);
  }

  async generateAndSendForUser(user) {
    try {
      console.log(`📧 Génération rapport pour ${user.email}...`);

      const reportData = await this.collectReportData(user);
      const result = await sendTriWeeklyReport(user.email, reportData);

      return result;
    } catch (error) {
      console.error(`❌ Erreur pour ${user.email}:`, error.message);
      console.error(`❌ Stack:`, error.stack);
      return { success: false, error: error.message };
    }
  }

  async collectReportData(user) {
  const endDate = moment().startOf('day');
  const startDate = moment().subtract(7, 'days').startOf('day');
  const previousStartDate = moment().subtract(14, 'days').startOf('day');

  const userCity = user.city || 'Dakar';

  const currentPeriodData = await SensorData.find({
    timestamp: { $gte: startDate.toDate(), $lt: endDate.toDate() }
  });

  const previousPeriodData = await SensorData.find({
    timestamp: { $gte: previousStartDate.toDate(), $lt: startDate.toDate() }
  });

  const stats = this.calculateStatistics(currentPeriodData, previousPeriodData, userCity);
  const predictions = await this.generatePredictions(userCity);
  const recommendations = this.generateRecommendations(stats);
  const tip = this.getWeeklyTip();

  return {
    userEmail: user.email,
    userName: user.getFullName(),  // ✅ Utilise ta méthode
    userCity,
    period: `${endDate.format('DD/MM')} - ${moment().add(7, 'days').format('DD/MM/YYYY')}`,
    daysCount: 7,
    ...stats,
    ...predictions,
    recommendations,
    tip
  };
}

  calculateStatistics(currentData, previousData, userCity) {
    // ✅ Filtrer par location.city (pas sensor.city)
    const cityData = currentData.filter(d => 
      d.location && d.location.city === userCity
    );

    if (cityData.length === 0) {
      return this.getDefaultStats(userCity);
    }

    // ✅ airQualityIndex existe directement
    const aqiValues = cityData.map(d => d.airQualityIndex).filter(v => v != null);
    const avgAqi = aqiValues.reduce((a, b) => a + b, 0) / aqiValues.length;

    // Grouper par jour
    const dayGroups = {};
    cityData.forEach(d => {
      const day = moment(d.timestamp).format('DD/MM');
      if (!dayGroups[day]) dayGroups[day] = [];
      dayGroups[day].push(d.airQualityIndex);
    });

    let bestDay = { date: '', aqi: Infinity };
    let worstDay = { date: '', aqi: 0 };

    Object.entries(dayGroups).forEach(([day, values]) => {
      const dayAvg = values.reduce((a, b) => a + b, 0) / values.length;
      if (dayAvg < bestDay.aqi) bestDay = { date: day, aqi: dayAvg };
      if (dayAvg > worstDay.aqi) worstDay = { date: day, aqi: dayAvg };
    });

    // Tendance vs période précédente
    const prevAqiValues = previousData
      .filter(d => d.location && d.location.city === userCity)
      .map(d => d.airQualityIndex)
      .filter(v => v != null);
    
    const prevAvgAqi = prevAqiValues.length > 0
      ? prevAqiValues.reduce((a, b) => a + b, 0) / prevAqiValues.length
      : avgAqi;

    const trendPercentage = Math.round(((avgAqi - prevAvgAqi) / prevAvgAqi) * 100);
    
    // Alertes (AQI > 100)
    const alertsCount = cityData.filter(d => d.airQualityIndex > 100).length;
    
    // Classement des villes
    const cityStats = this.calculateCityRankings(currentData);
    const userCityRank = cityStats.findIndex(c => c.name === userCity) + 1;
    
    // Impact santé
    const cigaretteEquivalent = this.calculateCigaretteEquivalent(avgAqi, 3);
    const unhealthyHours = Math.round(
      cityData.filter(d => d.airQualityIndex > 50).length / 2
    );

    return {
      avgAqi,
      bestDay,
      worstDay,
      trendPercentage,
      alertsCount,
      topCities: cityStats,
      userCityRank: userCityRank > 0 ? {
        position: userCityRank,
        total: cityStats.length
      } : null,
      cigaretteEquivalent,
      unhealthyHours
    };
  }

  calculateCityRankings(data) {
    const cityGroups = {};

    // ✅ Grouper par location.city
    data.forEach(d => {
      if (!d.location || !d.location.city) return;
      const city = d.location.city;
      if (!cityGroups[city]) cityGroups[city] = [];
      cityGroups[city].push(d.airQualityIndex);
    });

    return Object.entries(cityGroups)
      .map(([city, values]) => ({
        name: city,
        aqi: values.reduce((a, b) => a + b, 0) / values.length
      }))
      .sort((a, b) => a.aqi - b.aqi);
  }

  calculateCigaretteEquivalent(avgAqi, days) {
    // Formule : 1 cigarette ≈ 22 µg/m³ PM2.5
    // AQI to µg/m³ approximation
    const dailyExposure = (avgAqi * 0.5) / 22;
    return Math.max(0.1, Math.round(dailyExposure * days * 10) / 10);
  }

  async generatePredictions(city) {
    try {
      // Récupérer les sensorIds de la ville depuis les données récentes
      const recentData = await SensorData.find({
        'location.city': city,
        timestamp: { $gte: moment().subtract(24, 'hours').toDate() }
      }).distinct('sensorId');

      console.log(`🔮 [PREDICTIONS] Ville: ${city} | Capteurs trouvés: ${recentData.length} | IDs: ${JSON.stringify(recentData)}`);

      if (!recentData || recentData.length === 0) {
        console.log(`⚠️ [PREDICTIONS] Aucun capteur actif pour "${city}" → fallback`);
        return this.getDefaultPredictions();
      }

      const now = new Date();
      const in168h = new Date(now.getTime() + 168 * 60 * 60 * 1000);

      // Récupérer les prédictions des 7 prochains jours pour ces capteurs
      const preds = await Prediction.find({
        sensorId: { $in: recentData },
        predictionFor: { $gte: now, $lte: in168h }
      }).sort({ predictionFor: 1 });

      console.log(`🔮 [PREDICTIONS] Prédictions DB trouvées: ${preds.length}`);

      if (!preds || preds.length === 0) {
        console.log(`⚠️ [PREDICTIONS] Aucune prédiction en DB pour ces capteurs → fallback`);
        return this.getDefaultPredictions();
      }

      // Grouper par jour — labels avec vraies dates futures (ex: "Lun 21/04")
      const jours = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
      const dayLabels = Array.from({ length: 7 }, (_, i) => {
        const d = new Date(now.getTime() + i * 24 * 60 * 60 * 1000);
        const label = i === 0 ? "Aujourd'hui" : i === 1 ? 'Demain' : jours[d.getDay()];
        return `${label} ${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}`;
      });
      const dayGroups = Array.from({ length: 7 }, () => ({ sum: 0, count: 0 }));

      preds.forEach(p => {
        const diffH = (p.predictionFor - now) / (1000 * 60 * 60);
        const idx = Math.min(Math.floor(diffH / 24), 6);
        dayGroups[idx].sum += p.predictedAQI;
        dayGroups[idx].count += 1;
      });

      const predictions = dayLabels.map((day, i) => ({
        day,
        aqi: dayGroups[i].count > 0
          ? Math.round(dayGroups[i].sum / dayGroups[i].count)
          : null
      })).filter(p => p.aqi !== null);

      const bestDay = predictions.length > 0
        ? predictions.reduce((best, pred) => pred.aqi < best.aqi ? pred : best)
        : null;

      return {
        predictions,
        predictionsUnavailable: predictions.length === 0,
        bestPredictionDay: bestDay ? {
          message: `Meilleure qualité d'air prévue : ${bestDay.day} (AQI ${bestDay.aqi})`,
          bestTime: `${bestDay.day} entre 6h et 9h`
        } : null
      };
    } catch (error) {
      console.error('⚠️ Erreur récupération prédictions IA, fallback par défaut:', error.message);
      return this.getDefaultPredictions();
    }
  }

  getDefaultPredictions() {
    return {
      predictions: [],
      predictionsUnavailable: true,
      bestPredictionDay: null
    };
  }

  generateRecommendations(stats) {
    const recs = [];

    if (stats.avgAqi > 100) {
      recs.push({ icon: '🏃‍♂️', text: 'Limiter sport intense en extérieur' });
      recs.push({ icon: '😷', text: 'Porter un masque lors des sorties' });
    } else {
      recs.push({ icon: '✅', text: 'Qualité d\'air favorable pour activités outdoor' });
    }

    if (stats.trendPercentage > 10) {
      recs.push({ icon: '🏠', text: 'Aérer maison tôt le matin (air plus pur)' });
    }

    recs.push({ icon: '🌱', text: 'Planter des végétaux purificateurs d\'air' });

    return recs.slice(0, 3);
  }

  getWeeklyTip() {
    const tips = [
      {
        title: '🌿 Les plantes purifient l\'air',
        content: 'L\'Aloe Vera, le Ficus et la Sansevieria peuvent réduire la pollution intérieure jusqu\'à 10%. Trouvables facilement au marché Sandaga à Dakar.'
      },
      {
        title: '🚗 Évitez les heures de pointe',
        content: 'La pollution est 3x plus élevée entre 18h-20h à Dakar. Privilégiez vos sorties en matinée ou après 21h.'
      },
      {
        title: '💨 Aérez intelligemment',
        content: 'Ouvrez vos fenêtres tôt le matin (6h-8h) quand l\'air est le plus pur. Évitez d\'aérer en fin d\'après-midi.'
      },
      {
        title: '🧘 Respirez mieux',
        content: 'La respiration profonde quotidienne (5-10 min) aide vos poumons à éliminer les particules fines accumulées.'
      }
    ];

    const weekNumber = moment().week();
    return tips[weekNumber % tips.length];
  }

  getDefaultStats(userCity) {
    return {
      avgAqi: 50,
      bestDay: { date: 'Hier', aqi: 45 },
      worstDay: { date: 'Avant-hier', aqi: 55 },
      trendPercentage: 0,
      alertsCount: 0,
      topCities: [{ name: userCity, aqi: 50 }],
      userCityRank: { position: 1, total: 1 },
      cigaretteEquivalent: 0.5,
      unhealthyHours: 2
    };
  }
}

module.exports = new TriWeeklyReportService();