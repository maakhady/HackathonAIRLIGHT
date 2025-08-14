// routes/weather.js - Routes pour les données météo
const express = require('express');
const WeatherService = require('../services/WeatherService');
const AuthService = require('../services/AuthService');

const router = express.Router();
const weatherService = new WeatherService();
const authService = new AuthService();

// GET /weather/current - Météo actuelle
router.get('/current', async (req, res) => {
  try {
    const { city, lat, lon } = req.query;
    
    const result = await weatherService.getCurrentWeather(city, lat, lon);
    
    if (result.success) {
      res.json({
        success: true,
        data: result.data,
        message: `Météo actuelle pour ${result.data.location.name}`
      });
    } else {
      res.status(400).json(result);
    }
    
  } catch (error) {
    console.error('❌ Erreur route météo actuelle:', error.message);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération météo'
    });
  }
});

// GET /weather/forecast - Prévisions météo
router.get('/forecast', async (req, res) => {
  try {
    const { city, lat, lon, days = 5 } = req.query;
    
    // Validation
    if (days > 5) {
      return res.status(400).json({
        success: false,
        message: 'Maximum 5 jours de prévisions supportés'
      });
    }
    
    const result = await weatherService.getForecast(city, lat, lon, parseInt(days));
    
    if (result.success) {
      res.json({
        success: true,
        data: result.data,
        message: `Prévisions ${days} jours pour ${result.data.location.name}`
      });
    } else {
      res.status(400).json(result);
    }
    
  } catch (error) {
    console.error('❌ Erreur route prévisions:', error.message);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération des prévisions'
    });
  }
});

// GET /weather/cities - Météo pour toutes les villes avec capteurs
router.get('/cities', async (req, res) => {
  try {
    const result = await weatherService.getWeatherForAllSensorCities();
    
    if (result.success) {
      res.json({
        success: true,
        data: result.data,
        summary: result.summary,
        message: `Météo récupérée pour ${result.summary.successful} villes`
      });
    } else {
      res.status(500).json(result);
    }
    
  } catch (error) {
    console.error('❌ Erreur météo cities:', error.message);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération météo globale'
    });
  }
});

// GET /weather/air-quality-forecast - Prévision qualité air selon météo
router.get('/air-quality-forecast', async (req, res) => {
  try {
    const { city, lat, lon } = req.query;
    
    const result = await weatherService.getAirQualityForecast(city, lat, lon);
    
    if (result.success) {
      res.json({
        success: true,
        data: result.data,
        message: 'Analyse qualité air basée sur météo'
      });
    } else {
      res.status(400).json(result);
    }
    
  } catch (error) {
    console.error('❌ Erreur prévision qualité air:', error.message);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de l\'analyse qualité air'
    });
  }
});

// GET /weather/search - Recherche de villes
router.get('/search', async (req, res) => {
  try {
    const { q } = req.query;
    
    if (!q || q.length < 2) {
      return res.status(400).json({
        success: false,
        message: 'Requête de recherche trop courte (min 2 caractères)'
      });
    }
    
    const result = await weatherService.searchCity(q);
    
    if (result.success) {
      res.json({
        success: true,
        data: result.data,
        count: result.data.length,
        message: `${result.data.length} ville(s) trouvée(s)`
      });
    } else {
      res.status(400).json(result);
    }
    
  } catch (error) {
    console.error('❌ Erreur recherche ville:', error.message);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la recherche'
    });
  }
});

// GET /weather/stats - Statistiques du service météo
router.get('/stats', async (req, res) => {
  try {
    const stats = weatherService.getServiceStats();
    
    res.json({
      success: true,
      data: stats,
      message: 'Statistiques du service météo'
    });
    
  } catch (error) {
    console.error('❌ Erreur stats météo:', error.message);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération des statistiques'
    });
  }
});

// GET /weather/test - Test de connexion API (admin seulement)
router.get('/test', authService.requireAdmin.bind(authService), async (req, res) => {
  try {
    const result = await weatherService.testConnection();
    
    res.json({
      success: result.success,
      data: result,
      message: result.success ? 
        'Service météo opérationnel' : 
        'Problème avec le service météo'
    });
    
  } catch (error) {
    console.error('❌ Erreur test météo:', error.message);
    res.status(500).json({
      success: false,
      message: 'Erreur lors du test de connexion'
    });
  }
});

// GET /weather/impact/:sensorId - Impact météo sur un capteur spécifique
router.get('/impact/:sensorId', authService.authenticateToken.bind(authService), async (req, res) => {
  try {
    const { sensorId } = req.params;
    
    // Trouver la localisation du capteur (vous devrez adapter selon votre modèle)
    const SensorData = require('../models/SensorData');
    const sensorInfo = await SensorData.findOne({ sensorId }).sort({ timestamp: -1 });
    
    if (!sensorInfo || !sensorInfo.location) {
      return res.status(404).json({
        success: false,
        message: 'Capteur non trouvé ou sans localisation'
      });
    }
    
    // Récupérer météo pour ce capteur
    const weatherResult = await weatherService.getCurrentWeather(
      null, 
      sensorInfo.location.latitude, 
      sensorInfo.location.longitude
    );
    
    if (!weatherResult.success) {
      return res.status(400).json(weatherResult);
    }
    
    // Récupérer les dernières données du capteur
    const recentData = await SensorData
      .find({ sensorId })
      .sort({ timestamp: -1 })
      .limit(24); // 24 dernières mesures
    
    // Analyser corrélation météo/qualité air
    const correlation = analyzeWeatherAirQualityCorrelation(weatherResult.data, recentData);
    
    res.json({
      success: true,
      data: {
        sensorId,
        location: sensorInfo.location,
        weather: weatherResult.data,
        correlation,
        recommendations: generateRecommendations(weatherResult.data, correlation)
      },
      message: `Analyse météo/qualité air pour ${sensorId}`
    });
    
  } catch (error) {
    console.error('❌ Erreur impact météo capteur:', error.message);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de l\'analyse d\'impact'
    });
  }
});

// GET /weather/dashboard - Tableau de bord météo temps réel
router.get('/dashboard', async (req, res) => {
  try {
    const { cities = false } = req.query;
    
    let weatherData;
    
    if (cities === 'true') {
      // Météo pour toutes les villes
      weatherData = await weatherService.getWeatherForAllSensorCities();
    } else {
      // Météo Dakar seulement
      weatherData = await weatherService.getCurrentWeather('Dakar');
    }
    
    if (!weatherData.success) {
      return res.status(400).json(weatherData);
    }
    
    // Prévisions rapides
    const forecast = await weatherService.getForecast('Dakar', null, null, 3);
    
    const dashboard = {
      timestamp: new Date(),
      primary_location: cities === 'true' ? 'Multiple cities' : 'Dakar',
      current_weather: weatherData.data,
      forecast: forecast.success ? forecast.data.daily : [],
      alerts: generateWeatherAlerts(weatherData.data),
      air_quality_outlook: cities === 'true' ? null : 
        weatherService.analyzeAirQualityImpact(weatherData.data)
    };
    
    res.json({
      success: true,
      data: dashboard,
      message: 'Tableau de bord météo mis à jour'
    });
    
  } catch (error) {
    console.error('❌ Erreur dashboard météo:', error.message);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la génération du dashboard'
    });
  }
});

// Fonctions utilitaires

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
  
  // Calculer moyennes récentes PM2.5
  const avgPM25 = sensorData.reduce((sum, data) => sum + (data.measurements.pm25 || 0), 0) / sensorData.length;
  const recent6h = sensorData.slice(0, 6); // 6 dernières heures
  const avgPM25Recent = recent6h.reduce((sum, data) => sum + (data.measurements.pm25 || 0), 0) / recent6h.length;
  
  let correlation = {
    wind_dispersion: 'neutral',
    humidity_effect: 'neutral', 
    pressure_stability: 'neutral',
    trend: avgPM25Recent > avgPM25 ? 'increasing' : 'decreasing',
    confidence: 0.5
  };
  
  // Analyse vent/dispersion
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

function generateRecommendations(weatherData, correlation) {
  const recommendations = [];
  const wind = weatherData.current.wind.speed_kmh;
  const humidity = weatherData.current.humidity;
  
  // Recommandations selon vent
  if (wind > 20) {
    recommendations.push({
      type: 'ventilation',
      priority: 'high',
      message: '💨 Vent fort - Excellente opportunité d\'aérer les espaces intérieurs',
      action: 'Ouvrez largement les fenêtres pendant 30-60 minutes'
    });
  } else if (wind < 5) {
    recommendations.push({
      type: 'precaution',
      priority: 'medium',
      message: '😷 Vent faible - Risque de stagnation des polluants',
      action: 'Limitez les activités extérieures, utilisez un purificateur d\'air'
    });
  }
  
  // Recommandations selon humidité
  if (humidity > 85) {
    recommendations.push({
      type: 'health',
      priority: 'medium',
      message: '💧 Humidité très élevée - Les particules restent en suspension',
      action: 'Surveillez la qualité de l\'air, restez hydratés'
    });
  } else if (humidity < 30) {
    recommendations.push({
      type: 'dust',
      priority: 'medium',
      message: '🏜️ Air très sec - Risque accru de poussière',
      action: 'Portez un masque à l\'extérieur, hydratez-vous bien'
    });
  }
  
  // Saison Harmattan
  const month = new Date().getMonth();
  if (month >= 10 || month <= 1) {
    recommendations.push({
      type: 'seasonal',
      priority: 'high',
      message: '🌪️ Saison Harmattan - Poussière sahélienne attendue',
      action: 'Surveillance renforcée, fermez fenêtres lors des pics de vent'
    });
  }
  
  return recommendations;
}

function generateWeatherAlerts(weatherData) {
  const alerts = [];
  const wind = weatherData.current.wind.speed_kmh;
  const humidity = weatherData.current.humidity;
  const temp = weatherData.current.temperature;
  
  // Alerte vent fort
  if (wind > 30) {
    alerts.push({
      type: 'wind',
      severity: 'moderate',
      message: `Vent fort détecté (${wind} km/h) - Possible soulèvement de poussière`,
      icon: '💨'
    });
  }
  
  // Alerte chaleur/humidité
  if (temp > 35 && humidity > 70) {
    alerts.push({
      type: 'heat_humidity',
      severity: 'high', 
      message: `Chaleur et humidité élevées - Conditions défavorables à la qualité de l'air`,
      icon: '🌡️'
    });
  }
  
  // Alerte conditions stagnantes
  if (wind < 3 && humidity > 80) {
    alerts.push({
      type: 'stagnation',
      severity: 'moderate',
      message: 'Conditions météo favorables à la stagnation des polluants',
      icon: '😷'
    });
  }
  
  return alerts;
}

module.exports = router;