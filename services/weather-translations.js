// backend/services/weather-translations.js - Traductions alertes météo

const weatherTranslations = {
  // Capteurs météo -> Noms français
  sensorNames: {
    'WEATHER_RUFISQUE': 'Météo Rufisque',
    'WEATHER_RICHARD-TOLL': 'Météo Richard-Toll',
    'WEATHER_THIÈS': 'Météo Thiès',
    'WEATHER_DAKAR': 'Météo Dakar',
    'WEATHER_SAINT-LOUIS': 'Météo Saint-Louis',
    'WEATHER_DIOURBEL': 'Météo Diourbel',
    'WEATHER_ZIGUINCHOR': 'Météo Ziguinchor',
    'WEATHER_BIGNONA': 'Météo Bignona',
    'WEATHER_PIKINE': 'Météo Pikine',
    'WEATHER_KEUR_MASSAR': 'Météo Keur Massar'
  },

  // Villes -> Noms avec préposition
  cityNames: {
    'Rufisque': 'à Rufisque',
    'Richard-Toll': 'à Richard-Toll',
    'Thiès': 'à Thiès',
    'Dakar': 'à Dakar',
    'Saint-Louis': 'à Saint-Louis',
    'Diourbel': 'à Diourbel',
    'Ziguinchor': 'à Ziguinchor',
    'Bignona': 'à Bignona',
    'Pikine': 'à Pikine',
    'Keur Massar': 'à Keur Massar'
  },

  // Messages d'alerte Harmattan
  harmattan: {
    title: 'Conditions Harmattan actives',
    warning: 'Poussière sahélienne attendue',
    fullMessage: (city) => `Conditions Harmattan actives ${city} - Poussière sahélienne attendue`,
    
    recommendations: [
      '🌪️ Saison Harmattan : Augmentez la fréquence de nettoyage des filtres',
      '💧 Maintenez une bonne hydratation',
      '😷 Portez un masque en cas de vent fort',
      '🏠 Gardez les fenêtres fermées pendant les pics de poussière',
      '👁️ Protégez vos yeux de la poussière',
      '🚗 Réduisez la vitesse en cas de faible visibilité'
    ],

    healthInfo: {
      impact: '🌪️ Saison Harmattan - Poussière sahélienne en suspension',
      sensitiveGroups: ['Enfants', 'Personnes âgées', 'Asthmatiques', 'Personnes avec maladies respiratoires']
    }
  },

  // Conditions météo -> Français
  conditions: {
    'Clear': 'Dégagé',
    'Clouds': 'Nuageux',
    'Rain': 'Pluie',
    'Drizzle': 'Bruine',
    'Thunderstorm': 'Orage',
    'Snow': 'Neige',
    'Mist': 'Brume',
    'Smoke': 'Fumée',
    'Haze': 'Brume sèche',
    'Dust': 'Poussière',
    'Fog': 'Brouillard',
    'Sand': 'Sable',
    'Ash': 'Cendres',
    'Squall': 'Grain',
    'Tornado': 'Tornade'
  },

  // Niveaux de sévérité
  severity: {
    'good': 'Bon',
    'moderate': 'Modéré',
    'poor': 'Mauvais',
    'unhealthy': 'Malsain',
    'hazardous': 'Dangereux'
  },

  // États d'alerte
  status: {
    'active': 'Active',
    'resolved': 'Résolue',
    'acknowledged': 'Acquittée'
  }
};

/**
 * Traduire le message d'alerte météo
 */
function translateWeatherAlertMessage(alertType, city) {
  const cityFr = weatherTranslations.cityNames[city] || `à ${city}`;
  return weatherTranslations.harmattan.fullMessage(cityFr);
}

/**
 * Traduire le nom du capteur
 */
function translateSensorName(sensorId) {
  return weatherTranslations.sensorNames[sensorId] || sensorId;
}

/**
 * Obtenir les recommandations Harmattan
 */
function getHarmattanRecommendations() {
  return weatherTranslations.harmattan.recommendations;
}

/**
 * Obtenir les infos santé Harmattan
 */
function getHarmattanHealthInfo() {
  return weatherTranslations.harmattan.healthInfo;
}

/**
 * Traduire une condition météo
 */
function translateCondition(condition) {
  return weatherTranslations.conditions[condition] || condition;
}

/**
 * Traduire la sévérité
 */
function translateSeverity(severity) {
  return weatherTranslations.severity[severity] || severity;
}

/**
 * Traduire le statut
 */
function translateStatus(status) {
  return weatherTranslations.status[status?.toLowerCase()] || status;
}

module.exports = {
  weatherTranslations,
  translateWeatherAlertMessage,
  translateSensorName,
  getHarmattanRecommendations,
  getHarmattanHealthInfo,
  translateCondition,
  translateSeverity,
  translateStatus
};