const moment = require('moment');
const User = require('../models/User');
const SensorData = require('../models/SensorData');
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

  async generateAndSendForUser(user) {
    try {
      console.log(`📧 Génération rapport pour ${user.email}...`);

      const reportData = await this.collectReportData(user);
      const result = await sendTriWeeklyReport(user.email, reportData);

      return result;
    } catch (error) {
      console.error(`❌ Erreur pour ${user.email}:`, error);
      return { success: false, error: error.message };
    }
  }

  async collectReportData(user) {
  const endDate = moment().startOf('day');
  const startDate = moment().subtract(3, 'days').startOf('day');
  const previousStartDate = moment().subtract(6, 'days').startOf('day');

  const userCity = user.city || 'Dakar';

  const currentPeriodData = await SensorData.find({
    timestamp: { $gte: startDate.toDate(), $lt: endDate.toDate() }
  }).populate('sensor');

  const previousPeriodData = await SensorData.find({
    timestamp: { $gte: previousStartDate.toDate(), $lt: startDate.toDate() }
  }).populate('sensor');

  const stats = this.calculateStatistics(currentPeriodData, previousPeriodData, userCity);
  const predictions = this.generatePredictions(userCity);
  const recommendations = this.generateRecommendations(stats);
  const tip = this.getWeeklyTip();

  return {
    userEmail: user.email,
    userName: user.getFullName(),  // ✅ Utilise ta méthode
    userCity,
    period: `${startDate.format('DD/MM')} - ${endDate.format('DD/MM/YYYY')}`,
    daysCount: 3,
    ...stats,
    predictions,
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

  generatePredictions(city) {
    // TODO: Intégrer avec ton vrai service IA
    const days = ['Aujourd\'hui', 'Demain', 'Après-demain'];
    const predictions = days.map((day, i) => ({
      day,
      aqi: 45 + Math.random() * 30
    }));

    const bestDay = predictions.reduce((best, pred) => 
      pred.aqi < best.aqi ? pred : best
    );

    return {
      predictions,
      bestPredictionDay: {
        message: `Conditions favorables ${bestDay.day.toLowerCase()} grâce aux vents océaniques`,
        bestTime: `${bestDay.day} 6h-9h`
      }
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