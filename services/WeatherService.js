// services/WeatherService.js - Service météo avec OpenWeatherMap
const axios = require('axios');

class WeatherService {
  constructor() {
    this.apiKey = process.env.OPENWEATHER_API_KEY;
    this.baseURL = 'https://api.openweathermap.org/data/2.5';
    this.geocodingURL = 'https://api.openweathermap.org/geo/1.0';
    
    // Localisation par défaut (Dakar, Sénégal)
    this.defaultLocation = {
      lat: 14.6928,
      lon: -17.4467,
      name: 'Dakar',
      country: 'SN'
    };
    
    // Villes principales du Sénégal avec capteurs
    this.sensorCities = [
      { name: 'Dakar', lat: 14.6928, lon: -17.4467 },
      { name: 'Saint-Louis', lat: 16.0378, lon: -16.4889 },
      { name: 'Thiès', lat: 14.7886, lon: -16.9239 },
      { name: 'Diourbel', lat: 14.6522, lon: -16.2317 },
      { name: 'Richard-Toll', lat: 16.4617, lon: -15.7014 },
      { name: 'Rufisque', lat: 14.7672, lon: -17.2008 },
      { name: 'Pikine', lat: 14.7547, lon: -17.3906 }
    ];
    
    console.log('🌤️ Service météo initialisé avec OpenWeatherMap');
  }

  // 🔄 Méthode principale : Obtenir météo actuelle
  async getCurrentWeather(city = null, lat = null, lon = null) {
    try {
      if (!this.apiKey) {
        return {
          success: false,
          error: 'Clé API OpenWeather manquante',
          recommendation: 'Configurez OPENWEATHER_API_KEY dans .env'
        };
      }

      let params = {
        appid: this.apiKey,
        units: 'metric',
        lang: 'fr'
      };

      // Déterminer la localisation
      if (lat && lon) {
        params.lat = lat;
        params.lon = lon;
      } else if (city) {
        params.q = `${city},SN`; // Forcer Sénégal
      } else {
        params.lat = this.defaultLocation.lat;
        params.lon = this.defaultLocation.lon;
      }

      const response = await axios.get(`${this.baseURL}/weather`, {
        params,
        timeout: 10000
      });

      const weatherData = this.formatWeatherData(response.data);
      
      // Ajouter analyse qualité air/météo
      weatherData.airQualityImpact = this.analyzeAirQualityImpact(weatherData);
      
      console.log(`🌤️ Météo récupérée pour ${weatherData.location.name}`);
      
      return {
        success: true,
        data: weatherData
      };

    } catch (error) {
      console.error('❌ Erreur récupération météo:', error.message);
      
      if (error.response?.status === 401) {
        return {
          success: false,
          error: 'Clé API invalide',
          recommendation: 'Vérifiez votre OPENWEATHER_API_KEY'
        };
      }
      
      return {
        success: false,
        error: 'Erreur lors de la récupération météo',
        details: error.message
      };
    }
  }

  // 📅 Prévisions météo 5 jours
  async getForecast(city = null, lat = null, lon = null, days = 5) {
    try {
      if (!this.apiKey) {
        return {
          success: false,
          error: 'Clé API OpenWeather manquante'
        };
      }

      let params = {
        appid: this.apiKey,
        units: 'metric',
        lang: 'fr',
        cnt: days * 8 // 8 prévisions par jour (toutes les 3h)
      };

      if (lat && lon) {
        params.lat = lat;
        params.lon = lon;
      } else if (city) {
        params.q = `${city},SN`;
      } else {
        params.lat = this.defaultLocation.lat;
        params.lon = this.defaultLocation.lon;
      }

      const response = await axios.get(`${this.baseURL}/forecast`, {
        params,
        timeout: 15000
      });

      const forecastData = this.formatForecastData(response.data);
      
      console.log(`📅 Prévisions récupérées pour ${forecastData.location.name}`);
      
      return {
        success: true,
        data: forecastData
      };

    } catch (error) {
      console.error('❌ Erreur prévisions météo:', error.message);
      return {
        success: false,
        error: 'Erreur lors de la récupération des prévisions'
      };
    }
  }

  // 🌍 Météo pour toutes les villes avec capteurs
  async getWeatherForAllSensorCities() {
    try {
      console.log('🌍 Récupération météo pour toutes les villes...');
      
      const weatherPromises = this.sensorCities.map(async (city) => {
        try {
          const result = await this.getCurrentWeather(null, city.lat, city.lon);
          return {
            city: city.name,
            success: result.success,
            data: result.success ? result.data : null,
            error: result.success ? null : result.error
          };
        } catch (error) {
          return {
            city: city.name,
            success: false,
            data: null,
            error: error.message
          };
        }
      });

      const results = await Promise.all(weatherPromises);
      const successful = results.filter(r => r.success);
      
      console.log(`🌍 Météo récupérée pour ${successful.length}/${this.sensorCities.length} villes`);
      
      return {
        success: true,
        data: results,
        summary: {
          total: this.sensorCities.length,
          successful: successful.length,
          failed: results.length - successful.length
        }
      };

    } catch (error) {
      console.error('❌ Erreur météo globale:', error.message);
      return {
        success: false,
        error: 'Erreur lors de la récupération météo globale'
      };
    }
  }

  // 🏭 Qualité air selon météo
  async getAirQualityForecast(city = null, lat = null, lon = null) {
    try {
      const weather = await this.getCurrentWeather(city, lat, lon);
      
      if (!weather.success) {
        return weather;
      }

      const forecast = await this.getForecast(city, lat, lon, 3);
      
      const airQualityAnalysis = {
        current: this.analyzeAirQualityImpact(weather.data),
        forecast: forecast.success ? 
          forecast.data.daily.map(day => ({
            date: day.date,
            expected_aqi_impact: this.predictAQIFromWeather(day),
            dust_risk: this.assessDustRisk(day),
            ventilation_conditions: this.assessVentilation(day)
          })) : []
      };

      return {
        success: true,
        data: {
          weather: weather.data,
          airQualityAnalysis
        }
      };

    } catch (error) {
      console.error('❌ Erreur analyse qualité air météo:', error.message);
      return {
        success: false,
        error: 'Erreur lors de l\'analyse qualité air'
      };
    }
  }

  // 🔍 Recherche de ville
  async searchCity(query) {
    try {
      if (!this.apiKey) {
        return { success: false, error: 'Clé API manquante' };
      }

      const response = await axios.get(`${this.geocodingURL}/direct`, {
        params: {
          q: `${query},SN`, // Limiter au Sénégal
          limit: 5,
          appid: this.apiKey
        },
        timeout: 10000
      });

      const cities = response.data.map(city => ({
        name: city.name,
        country: city.country,
        state: city.state,
        lat: city.lat,
        lon: city.lon,
        local_names: city.local_names
      }));

      return {
        success: true,
        data: cities
      };

    } catch (error) {
      console.error('❌ Erreur recherche ville:', error.message);
      return {
        success: false,
        error: 'Erreur lors de la recherche'
      };
    }
  }

  // 📊 Formatage données météo
  formatWeatherData(rawData) {
    const now = new Date();
    
    return {
      location: {
        name: rawData.name,
        country: rawData.sys.country,
        coordinates: {
          lat: rawData.coord.lat,
          lon: rawData.coord.lon
        },
        timezone: rawData.timezone,
        sunrise: new Date(rawData.sys.sunrise * 1000),
        sunset: new Date(rawData.sys.sunset * 1000)
      },
      current: {
        timestamp: now,
        temperature: Math.round(rawData.main.temp),
        feels_like: Math.round(rawData.main.feels_like),
        humidity: rawData.main.humidity,
        pressure: rawData.main.pressure,
        visibility: rawData.visibility / 1000, // en km
        uv_index: rawData.uvi || null,
        
        weather: {
          main: rawData.weather[0].main,
          description: rawData.weather[0].description,
          icon: rawData.weather[0].icon,
          id: rawData.weather[0].id
        },
        
        wind: {
          speed: rawData.wind?.speed || 0, // m/s
          speed_kmh: Math.round((rawData.wind?.speed || 0) * 3.6),
          direction: rawData.wind?.deg || 0,
          gust: rawData.wind?.gust || null
        },
        
        clouds: rawData.clouds?.all || 0,
        rain: rawData.rain ? {
          '1h': rawData.rain['1h'] || 0,
          '3h': rawData.rain['3h'] || 0
        } : null,
        snow: rawData.snow ? {
          '1h': rawData.snow['1h'] || 0,
          '3h': rawData.snow['3h'] || 0
        } : null
      }
    };
  }

  // 📅 Formatage prévisions
  formatForecastData(rawData) {
    const daily = [];
    const hourly = [];

    // Grouper par jour
    const dayGroups = {};
    
    rawData.list.forEach(item => {
      const date = new Date(item.dt * 1000);
      const dayKey = date.toISOString().split('T')[0];
      
      if (!dayGroups[dayKey]) {
        dayGroups[dayKey] = [];
      }
      dayGroups[dayKey].push(item);
      
      // Données horaires
      hourly.push({
        datetime: date,
        temperature: Math.round(item.main.temp),
        humidity: item.main.humidity,
        wind_speed: item.wind?.speed || 0,
        weather: item.weather[0].description,
        clouds: item.clouds?.all || 0,
        pop: Math.round((item.pop || 0) * 100) // Probabilité précipitation
      });
    });

    // Créer résumés quotidiens
    Object.keys(dayGroups).forEach(dayKey => {
      const dayData = dayGroups[dayKey];
      const temps = dayData.map(d => d.main.temp);
      const humidities = dayData.map(d => d.main.humidity);
      const winds = dayData.map(d => d.wind?.speed || 0);
      
      daily.push({
        date: dayKey,
        temperature: {
          min: Math.round(Math.min(...temps)),
          max: Math.round(Math.max(...temps)),
          avg: Math.round(temps.reduce((a, b) => a + b, 0) / temps.length)
        },
        humidity: {
          avg: Math.round(humidities.reduce((a, b) => a + b, 0) / humidities.length)
        },
        wind: {
          avg_speed: Math.round(winds.reduce((a, b) => a + b, 0) / winds.length),
          max_speed: Math.round(Math.max(...winds))
        },
        weather: dayData[Math.floor(dayData.length / 2)].weather[0].description,
        clouds: Math.round(dayData.reduce((sum, d) => sum + (d.clouds?.all || 0), 0) / dayData.length)
      });
    });

    return {
      location: {
        name: rawData.city.name,
        country: rawData.city.country,
        coordinates: {
          lat: rawData.city.coord.lat,
          lon: rawData.city.coord.lon
        }
      },
      daily,
      hourly: hourly.slice(0, 48), // Limiter à 48h
      generated_at: new Date()
    };
  }

  // 🌪️ Analyse impact qualité air
  analyzeAirQualityImpact(weatherData) {
    const wind = weatherData.current.wind;
    const humidity = weatherData.current.humidity;
    const pressure = weatherData.current.pressure;
    const clouds = weatherData.current.clouds;
    
    let impact = {
      overall: 'neutral',
      score: 0, // -100 (très mauvais) à +100 (très bon)
      factors: []
    };

    // Vent (très important pour disperser pollution)
    if (wind.speed_kmh > 20) {
      impact.score += 40;
      impact.factors.push('💨 Vent fort - Excellente dispersion des polluants');
    } else if (wind.speed_kmh > 10) {
      impact.score += 20;
      impact.factors.push('🌬️ Vent modéré - Bonne dispersion');
    } else if (wind.speed_kmh < 5) {
      impact.score -= 30;
      impact.factors.push('😷 Vent faible - Stagnation des polluants');
    }

    // Humidité
    if (humidity > 80) {
      impact.score -= 20;
      impact.factors.push('💧 Humidité élevée - Particules restent en suspension');
    } else if (humidity < 40) {
      impact.score -= 15;
      impact.factors.push('🏜️ Air sec - Plus de poussière');
    }

    // Pression atmosphérique
    if (pressure < 1010) {
      impact.score -= 15;
      impact.factors.push('📉 Basse pression - Piégeage des polluants');
    } else if (pressure > 1020) {
      impact.score += 10;
      impact.factors.push('📈 Haute pression - Conditions stables');
    }

    // Couverture nuageuse
    if (clouds > 80) {
      impact.score -= 10;
      impact.factors.push('☁️ Très nuageux - Moins de photo-dégradation');
    }

    // Saison Harmattan (Nov-Fév)
    const month = new Date().getMonth();
    if (month >= 10 || month <= 1) {
      impact.score -= 25;
      impact.factors.push('🌪️ Saison Harmattan - Poussière sahélienne');
    }

    // Déterminer impact global
    if (impact.score > 20) {
      impact.overall = 'beneficial';
    } else if (impact.score < -20) {
      impact.overall = 'detrimental';
    }

    return impact;
  }

  // 🔮 Prédiction AQI selon météo
  predictAQIFromWeather(dayWeather) {
    let prediction = 'stable';
    let confidence = 0.5;
    
    // Vent fort = amélioration
    if (dayWeather.wind.avg_speed > 15) {
      prediction = 'improvement';
      confidence = 0.8;
    }
    // Vent faible + humidité = dégradation
    else if (dayWeather.wind.avg_speed < 5 && dayWeather.humidity.avg > 75) {
      prediction = 'deterioration';
      confidence = 0.7;
    }

    return { prediction, confidence };
  }

  // 🏜️ Évaluation risque poussière
  assessDustRisk(dayWeather) {
    let risk = 'low';
    
    // Conditions favorables à la poussière
    if (dayWeather.wind.max_speed > 25 && dayWeather.humidity.avg < 40) {
      risk = 'high';
    } else if (dayWeather.wind.avg_speed > 15 && dayWeather.humidity.avg < 60) {
      risk = 'moderate';
    }
    
    return risk;
  }

  // 🪟 Conditions de ventilation
  assessVentilation(dayWeather) {
    const wind = dayWeather.wind.avg_speed;
    
    if (wind > 15) return 'excellent';
    if (wind > 8) return 'good';
    if (wind > 3) return 'fair';
    return 'poor';
  }

  // 🔧 Test de connexion API
  async testConnection() {
    try {
      if (!this.apiKey) {
        return {
          success: false,
          error: 'Clé API manquante',
          recommendation: 'Configurez OPENWEATHER_API_KEY dans .env'
        };
      }

      // Test simple sur Dakar
      const result = await this.getCurrentWeather('Dakar');
      
      if (result.success) {
        return {
          success: true,
          message: 'Connexion OpenWeatherMap réussie',
          location_tested: 'Dakar',
          data_available: true
        };
      } else {
        return result;
      }

    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  // 📊 Statistiques du service
  getServiceStats() {
    return {
      service: 'OpenWeatherMap',
      cities_configured: this.sensorCities.length,
      default_location: this.defaultLocation.name,
      api_endpoints: [
        'current weather',
        'forecast',
        'geocoding',
        'air quality analysis'
      ],
      features: [
        'Météo temps réel',
        'Prévisions 5 jours',
        'Analyse impact qualité air',
        'Données en français',
        'Recherche de villes'
      ]
    };
  }
}

module.exports = WeatherService;