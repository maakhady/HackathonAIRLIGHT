// services/AirGradientService.js - SANS SIMULATION si offline/pas de données
const axios = require('axios');

class AirGradientService {
  constructor() {
    this.baseURL = 'https://api.airgradient.com/public/api/v1';
    this.apiKey = process.env.AIRGRADIENT_API_KEY;
    
    // Liste complète des capteurs
    this.sensorLocations = [
      { 
        serialNo: 'd83bdad43d8', 
        serialNumeric: parseInt('d83bdad43d8', 16),
        name: 'Breath4life', 
        city: 'Dakar',
        country: 'SN',
        coordinates: { lat: 14.6928, lng: -17.4467 }
      },
      { 
        serialNo: 'd83bdae490', 
        serialNumeric: parseInt('d83bdae490', 16),
        name: 'École Élémentaire Ndiangué, Richard-Toll', 
        city: 'Richard-Toll',
        country: 'SN',
        coordinates: { lat: 16.4617, lng: -15.7014 }
      },
      { 
        serialNo: '34b7da12e68c', 
        serialNumeric: parseInt('34b7da12e68c', 16),
        name: 'École Elhadj Mbaye Diop (Multimedia), Ouakam, Dakar', 
        city: 'Dakar',
        country: 'SN',
        coordinates: { lat: 14.7167, lng: -17.4833 }
      },
      { 
        serialNo: '34b7da9fed44', 
        serialNumeric: parseInt('34b7da9fed44', 16),
        name: 'École Notre Dame des Victoires, Diourbel', 
        city: 'Diourbel',
        country: 'SN',
        coordinates: { lat: 14.6522, lng: -16.2317 }
      },
      { 
        serialNo: '34b7daa1e1b0', 
        serialNumeric: parseInt('34b7daa1e1b0', 16),
        name: 'Université de Thiès', 
        city: 'Thiès',
        country: 'SN',
        coordinates: { lat: 14.7886, lng: -16.9239 }
      },
      { 
        serialNo: '34b7daa1e7f4', 
        serialNumeric: parseInt('34b7daa1e7f4', 16),
        name: 'Lycée Cheikh Mouhamadou Moustapha Mbacké, Diourbel', 
        city: 'Diourbel',
        country: 'SN',
        coordinates: { lat: 14.6522, lng: -16.2317 }
      },
      { 
        serialNo: '744dbdbecb74', 
        serialNumeric: parseInt('744dbdbecb74', 16),
        name: 'Lycée Technique André Peytavin, Saint-Louis', 
        city: 'Saint-Louis',
        country: 'SN',
        coordinates: { lat: 16.0378, lng: -16.4889 }
      },
      { 
        serialNo: '744dbdbfbda4', 
        serialNumeric: parseInt('744dbdbfbda4', 16),
        name: 'Lycée de Bargny, Rufisque', 
        city: 'Rufisque',
        country: 'SN',
        coordinates: { lat: 14.7672, lng: -17.2008 }
      },
      { 
        serialNo: '744dbdc13e64', 
        serialNumeric: parseInt('744dbdc13e64', 16),
        name: 'Station de référence, Pikine', 
        city: 'Pikine',
        country: 'SN',
        coordinates: { lat: 14.7547, lng: -17.3906 }
      },
      { 
        serialNo: 'd83bda1cc9bc', 
        serialNumeric: parseInt('d83bda1cc9bc', 16),
        name: 'SunuAir', 
        city: 'Dakar',
        country: 'SN',
        coordinates: { lat: 14.6928, lng: -17.4467 }
      },
      { 
        serialNo: 'd83bda1bc450', 
        serialNumeric: parseInt('d83bda1bc450', 16),
        name: 'AirLight', 
        city: 'Dakar',
        country: 'SN',
        coordinates: { lat: 14.6928, lng: -17.4467 }
      },
      {
        serialNo: '34b7dabd9240',
        serialNumeric: parseInt('34b7dabd9240', 16),
        name: 'kaikai_office(indoor)',
        city: 'Dakar',
        country: 'SN',
        coordinates: { lat: 14.6928, lng: -17.4467 },
        type: 'indoor'
      },
      {
        serialNo: '34b7dad310ac',
        serialNumeric: parseInt('34b7dad310ac', 16),
        name: 'École Elhadj Mbaye Diop, Ouakam, Dakar',
        city: 'Dakar',
        country: 'SN',
        coordinates: { lat: 14.7167, lng: -17.4833 }
      },
      {
        serialNo: '744dbdc131f0',
        serialNumeric: parseInt('744dbdc131f0', 16),
        name: 'kaikai test',
        city: 'Dakar',
        country: 'SN',
        coordinates: { lat: 14.6928, lng: -17.4467 }
      },
      {
        serialNo: 'd83bdafc03bc',
        serialNumeric: parseInt('d83bdafc03bc', 16),
        name: 'SunuAir',
        city: 'Dakar',
        country: 'SN',
        coordinates: { lat: 14.6928, lng: -17.4467 }
      },
      {
        serialNo: '34b7da14e004',
        serialNumeric: parseInt('34b7da14e004', 16),
        name: 'École Elhadj Mbaye Diop Test',
        city: 'Dakar',
        country: 'SN',
        coordinates: { lat: 14.7167, lng: -17.4833 }
      }
    ];
    
    // Supprimer les doublons
    this.sensorLocations = this.sensorLocations.filter((sensor, index, self) =>
      index === self.findIndex(s => s.serialNo === sensor.serialNo)
    );
    
    this.apiStatus = {
      worldDataAccess: null,
      individualAccess: null,
      lastChecked: null,
      isOnline: false // ✅ NOUVEAU: Tracker si AirGradient est online
    };
    
    console.log(`🇸🇳 Service AirGradient initialisé avec ${this.sensorLocations.length} capteurs uniques du Sénégal`);
  }
  
  getHeaders() {
    return {
      'Content-Type': 'application/json',
      'User-Agent': 'AirLight/1.0'
    };
  }
  
  getAuthParams(additionalParams = {}) {
    if (!this.apiKey) {
      return additionalParams;
    }
    return {
      token: this.apiKey,
      ...additionalParams
    };
  }
  
  /**
   * ✅ Test de connexion - Marque le service comme online/offline
   */
  async testAPIConnection() {
    try {
      if (!this.apiKey) {
        console.log('⚠️ Pas de clé API configurée');
        this.apiStatus.isOnline = false;
        return { 
          success: false, 
          error: 'API Key manquante',
          recommendation: 'Configurez AIRGRADIENT_API_KEY dans .env'
        };
      }
      
      console.log('🔌 Test de connexion AirGradient...');
      
      // Test ping de base
      try {
        await axios.get(`${this.baseURL}/ping`, {
          headers: this.getHeaders(),
          params: this.getAuthParams(),
          timeout: 10000
        });
        
        console.log('✅ Ping API réussi');
        this.apiStatus.isOnline = true; // ✅ Marquer comme online
        
      } catch (pingError) {
        console.log('❌ Ping API échoué:', pingError.response?.status || pingError.message);
        this.apiStatus.isOnline = false; // ✅ Marquer comme offline
        return { 
          success: false, 
          error: 'API non accessible',
          details: pingError.response?.status || pingError.message
        };
      }
      
      // Test accès données mondiales
      try {
        const worldResponse = await axios.get(`${this.baseURL}/world/locations/measures/current`, {
          headers: this.getHeaders(),
          params: this.getAuthParams(),
          timeout: 15000
        });
        
        this.apiStatus.worldDataAccess = true;
        console.log(`✅ Accès données mondiales: ${worldResponse.data?.length || 0} mesures`);
        
      } catch (worldError) {
        this.apiStatus.worldDataAccess = false;
        
        if (worldError.response?.status === 401) {
          console.log('🔒 Accès données mondiales: 401 Unauthorized');
        } else if (worldError.response?.status === 403) {
          console.log('🔒 Accès données mondiales: 403 Forbidden');
        } else {
          console.log(`⚠️ Accès données mondiales: ${worldError.response?.status || 'Erreur réseau'}`);
        }
      }
      
      this.apiStatus.lastChecked = new Date();
      
      return { 
        success: true, 
        status: 200,
        worldDataAccess: this.apiStatus.worldDataAccess,
        isOnline: this.apiStatus.isOnline,
        sensorsConfigured: this.sensorLocations.length,
        message: this.apiStatus.worldDataAccess 
          ? 'API complètement accessible' 
          : 'API accessible mais données mondiales restreintes'
      };
      
    } catch (error) {
      this.apiStatus.isOnline = false; // ✅ Marquer comme offline en cas d'erreur
      return { 
        success: false, 
        error: error.response?.data || error.message,
        isOnline: false
      };
    }
  }
  
  /**
   * ✅ MODIFIÉ: Récupération données mondiales - retourne vide si offline
   */
  async tryFetchWorldData() {
    // ✅ NOUVEAU: Vérifier si le service est online
    if (!this.apiStatus.isOnline) {
      console.log('🔒 Service AirGradient offline - pas de récupération de données');
      return [];
    }
    
    if (this.apiStatus.worldDataAccess === false) {
      console.log('🔒 Accès données mondiales refusé - pas de données disponibles');
      return [];
    }
    
    try {
      console.log('🌍 Tentative de récupération des données mondiales...');
      
      const response = await axios.get(`${this.baseURL}/world/locations/measures/current`, {
        headers: this.getHeaders(),
        params: this.getAuthParams(),
        timeout: 15000
      });
      
      const worldData = response.data || [];
      this.apiStatus.worldDataAccess = true;
      
      console.log(`🌍 ${worldData.length} mesures mondiales récupérées avec succès`);
      
      // Chercher vos capteurs dans les données mondiales
      const yourSensorsData = worldData.filter(measurement => {
        return this.sensorLocations.some(sensor => {
          const serialMatch = sensor.serialNo === measurement.serialno || 
                             sensor.serialNumeric === measurement.serialno;
          
          const nameMatch = sensor.name && measurement.locationName &&
                           (sensor.name.toLowerCase().includes(measurement.locationName.toLowerCase()) ||
                            measurement.locationName.toLowerCase().includes(sensor.name.toLowerCase()));
          
          return serialMatch || nameMatch;
        });
      });
      
      console.log(`🇸🇳 ${yourSensorsData.length} de vos capteurs trouvés dans les données mondiales`);
      
      // Log détaillé des capteurs trouvés
      yourSensorsData.forEach(data => {
        const sensor = this.sensorLocations.find(s => 
          s.serialNo === data.serialno || s.serialNumeric === data.serialno
        );
        if (sensor) {
          console.log(`📡 Données trouvées: ${sensor.name} (${data.serialno}) - PM2.5: ${data.pm02}`);
        }
      });
      
      return yourSensorsData;
      
    } catch (error) {
      this.apiStatus.worldDataAccess = false;
      this.apiStatus.isOnline = false; // ✅ Marquer comme offline si erreur
      
      console.log(`❌ Erreur accès données mondiales: ${error.response?.status || error.message}`);
      return [];
    }
  }
  
  /**
   * ✅ MODIFIÉ: Récupération données réelles - pas de simulation si offline
   */
  async fetchRealAirGradientData() {
    try {
      if (!this.apiKey) {
        console.log('⚠️ Pas de clé API configurée - aucune donnée disponible');
        return []; // ✅ Retourner vide au lieu de simuler
      }

      console.log('🌍 Tentative de récupération des données réelles...');
      
      // Essayer plusieurs endpoints
      const endpoints = [
        `${this.baseURL}/world/locations/measures/current`,
        `${this.baseURL}/world/measures/current`,
        `${this.baseURL}/locations/measures/current`,
        `${this.baseURL}/measures/current`
      ];

      for (const endpoint of endpoints) {
        try {
          console.log(`🔗 Test endpoint: ${endpoint}`);
          
          const response = await axios.get(endpoint, {
            headers: this.getHeaders(),
            params: this.getAuthParams(),
            timeout: 15000
          });

          if (response.data && Array.isArray(response.data) && response.data.length > 0) {
            console.log(`✅ ${response.data.length} mesures récupérées depuis ${endpoint}`);
            this.apiStatus.isOnline = true; // ✅ Marquer comme online
            return this.processRealData(response.data);
          } else {
            console.log(`⚠️ Endpoint ${endpoint} - pas de données`);
          }
        } catch (error) {
          console.log(`❌ Endpoint ${endpoint} échoué: ${error.response?.status || error.message}`);
          continue;
        }
      }

      // ✅ Si aucun endpoint ne fonctionne - PAS DE SIMULATION
      console.log('❌ Aucune donnée réelle accessible - service offline');
      this.apiStatus.isOnline = false;
      return []; // ✅ Retourner vide au lieu de simuler

    } catch (error) {
      console.error('❌ Erreur récupération données:', error.message);
      this.apiStatus.isOnline = false;
      return []; // ✅ Retourner vide au lieu de simuler
    }
  }

  /**
   * ✅ MODIFIÉ: Traiter les données réelles - pas de simulation pour les manquants
   */
  processRealData(worldData) {
    const realSensorsData = [];

    // Chercher SEULEMENT vos capteurs dans les données mondiales
    for (const measurement of worldData) {
      const sensor = this.sensorLocations.find(s => 
        s.serialNo === measurement.serialno || 
        s.serialNumeric === measurement.serialno ||
        (s.name && measurement.locationName && 
         (s.name.toLowerCase().includes(measurement.locationName.toLowerCase()) ||
          measurement.locationName.toLowerCase().includes(s.name.toLowerCase())))
      );

      if (sensor) {
        realSensorsData.push({
          location: {
            id: sensor.serialNo,
            name: sensor.name,
            city: sensor.city,
            country: sensor.country,
            coordinates: sensor.coordinates
          },
          data: [this.normalizeRealData(measurement)]
        });
        console.log(`✅ Données réelles trouvées pour ${sensor.name} - PM2.5: ${measurement.pm02}`);
      }
    }

    // ✅ PAS DE SIMULATION pour les capteurs manquants
    console.log(`📊 Total: ${realSensorsData.length} capteurs avec données réelles (pas de simulation)`);
    return realSensorsData;
  }
  
  /**
   * ✅ MODIFIÉ: Méthode principale - pas de simulation si offline
   */
  async fetchAllSensorsData() {
    console.log('🔄 Collecte des données de tous vos capteurs AirGradient...');
    
    // Tester les permissions si pas encore fait
    if (this.apiStatus.worldDataAccess === null) {
      await this.testAPIConnection();
    }
    
    // ✅ Vérifier si le service est online
    if (!this.apiStatus.isOnline) {
      console.log('❌ Service AirGradient offline - aucune donnée disponible');
      return []; // ✅ Retourner vide au lieu de simuler
    }
    
    // Essayer de récupérer les données réelles
    if (this.apiKey) {
      const realData = await this.fetchRealAirGradientData();
      
      if (realData && realData.length > 0) {
        console.log(`✅ ${realData.length} capteurs avec données réelles récupérées`);
        return realData;
      }
    }
    
    // ✅ PAS DE SIMULATION - retourner vide si pas de données
    console.log('❌ Aucune donnée réelle disponible - retour de liste vide');
    return [];
  }
  
  /**
   * ✅ NOUVELLE MÉTHODE: Obtenir la liste des capteurs configurés (sans données)
   */
  getSensorLocations() {
    return this.sensorLocations.map(sensor => ({
      id: sensor.serialNo,
      serialNo: sensor.serialNo,
      serialNumeric: sensor.serialNumeric,
      name: sensor.name,
      city: sensor.city,
      country: sensor.country,
      coordinates: sensor.coordinates,
      type: sensor.type || 'outdoor'
    }));
  }
  
  /**
   * ✅ NOUVELLE MÉTHODE: Forcer une synchronisation sans simulation
   */
  async forceSyncRealTimeData() {
    console.log('🔄 Synchronisation forcée sans simulation...');
    
    try {
      // Réinitialiser le statut
      this.apiStatus.worldDataAccess = null;
      this.apiStatus.isOnline = false;
      
      // Forcer un nouveau test de connexion
      const connectionTest = await this.testAPIConnection();
      
      if (!connectionTest.success || !this.apiStatus.isOnline) {
        console.log('❌ Service AirGradient offline - aucune donnée disponible');
        return [];
      }
      
      // Essayer de récupérer les vraies données
      const realData = await this.fetchRealAirGradientData();
      
      if (realData && realData.length > 0) {
        console.log(`✅ Synchronisation réussie: ${realData.length} capteurs avec données`);
        return realData;
      } else {
        console.log('❌ Aucune donnée réelle disponible après synchronisation');
        return [];
      }
      
    } catch (error) {
      console.error('❌ Erreur synchronisation forcée:', error.message);
      this.apiStatus.isOnline = false;
      return [];
    }
  }
  
  // ✅ MÉTHODES UTILITAIRES (gardées mais pas utilisées pour simulation)
  normalizeRealData(apiData) {
    return {
      serialno: apiData.serialno,
      locationId: apiData.locationId,
      locationName: apiData.locationName,
      timestamp: apiData.timestamp || new Date().toISOString(),
      pm01: apiData.pm01 || 0,
      pm02: apiData.pm02 || 0,
      pm25: apiData.pm02 || apiData.pm25 || 0,
      pm10: apiData.pm10 || 0,
      pm003Count: apiData.pm003Count || 0,
      atmp: apiData.atmp || 25,
      rhum: apiData.rhum || 50,
      co2: apiData.rco2 || apiData.co2 || 400,
      rco2: apiData.rco2 || apiData.co2 || 400,
      tvoc: apiData.tvoc || 0,
      tvocIndex: apiData.tvocIndex || 0,
      noxIndex: apiData.noxIndex || 0,
      wifi: apiData.wifi || -50,
      model: apiData.model || 'I-9PSL',
      firmwareVersion: apiData.firmwareVersion || '3.3.9',
      latitude: apiData.latitude,
      longitude: apiData.longitude,
      source: 'real_api'
    };
  }
  
  transformDataForStorage(rawData, locationInfo) {
    if (!Array.isArray(rawData)) {
      console.warn('⚠️ Données invalides (pas un array)');
      return [];
    }
    
    return rawData.map(measurement => {
      const pm25 = measurement.pm02 || measurement.pm25 || 0;
      const pm10 = measurement.pm10 || 0;
      const co2 = measurement.rco2 || measurement.co2 || 400;
      
      const { aqi, level } = this.calculateAQI(pm25, pm10, co2);
      
      return {
        sensorId: locationInfo.id,
        location: {
          name: locationInfo.name,
          city: locationInfo.city,
          country: locationInfo.country,
          latitude: measurement.latitude || locationInfo.coordinates?.lat,
          longitude: measurement.longitude || locationInfo.coordinates?.lng
        },
        measurements: {
          pm25: pm25,
          pm10: pm10,
          pm1: measurement.pm01 || 0,
          co2: co2,
          tvoc: measurement.tvocIndex || measurement.tvoc || 0,
          nox: measurement.noxIndex || 0,
          temperature: measurement.atmp || 25,
          humidity: measurement.rhum || 50
        },
        airQualityIndex: aqi,
        qualityLevel: level,
        timestamp: new Date(measurement.timestamp || Date.now()),
        source: 'airgradient_real' // ✅ Seulement des données réelles
      };
    });
  }
  
  calculateAQI(pm25, pm10, co2) {
    let aqi = 0;
    let level = 'good';
    
    if (pm25 <= 12) {
      aqi = Math.max(aqi, (pm25 / 12) * 50);
    } else if (pm25 <= 35.4) {
      aqi = Math.max(aqi, 50 + ((pm25 - 12) / (35.4 - 12)) * 50);
      level = 'moderate';
    } else if (pm25 <= 55.4) {
      aqi = Math.max(aqi, 100 + ((pm25 - 35.4) / (55.4 - 35.4)) * 50);
      level = 'poor';
    } else {
      aqi = Math.max(aqi, 150 + ((pm25 - 55.4) / (150.4 - 55.4)) * 50);
      level = 'very_poor';
    }
    
    if (pm10 > 54) {
      aqi = Math.max(aqi, 100 + ((pm10 - 54) / (154 - 54)) * 50);
      if (level === 'good') level = 'moderate';
    }
    
    if (co2 > 1000) {
      aqi = Math.max(aqi, 100);
      if (level === 'good') level = 'moderate';
    }
    
    return { 
      aqi: Math.round(aqi), 
      level 
    };
  }
  
  /**
   * ✅ MODIFIÉ: Statistiques du compte sans simulation
   */
  async getAccountStats() {
    const cities = [...new Set(this.sensorLocations.map(s => s.city))];
    const indoorSensors = this.sensorLocations.filter(s => s.type === 'indoor').length;
    const outdoorSensors = this.sensorLocations.filter(s => s.type !== 'indoor').length;
    
    return {
      totalSensors: this.sensorLocations.length,
      indoorSensors,
      outdoorSensors,
      country: 'Sénégal',
      cities,
      citiesCount: cities.length,
      // ✅ Informations sur l'état du service
      serviceOnline: this.apiStatus.isOnline,
      worldDataAccess: this.apiStatus.worldDataAccess,
      dataSource: this.apiStatus.isOnline ? 'real_only' : 'offline', // ✅ Pas de simulation
      lastApiCheck: this.apiStatus.lastChecked,
      lastUpdate: new Date().toISOString(),
      apiKeyConfigured: !!this.apiKey,
      simulationEnabled: false, // ✅ Toujours false
      sensorsDetailed: {
        'Dakar': this.sensorLocations.filter(s => s.city === 'Dakar').length,
        'Saint-Louis': this.sensorLocations.filter(s => s.city === 'Saint-Louis').length,
        'Thiès': this.sensorLocations.filter(s => s.city === 'Thiès').length,
        'Diourbel': this.sensorLocations.filter(s => s.city === 'Diourbel').length,
        'Richard-Toll': this.sensorLocations.filter(s => s.city === 'Richard-Toll').length,
        'Rufisque': this.sensorLocations.filter(s => s.city === 'Rufisque').length,
        'Pikine': this.sensorLocations.filter(s => s.city === 'Pikine').length
      }
    };
  }
  
  /**
   * ✅ NOUVEAU: Diagnostic sans simulation
   */
  async runDiagnostic() {
    console.log('🔧 Diagnostic AirGradient (mode réel seulement)...');
    
    const diagnostic = {
      timestamp: new Date().toISOString(),
      serviceMode: 'real_data_only', // ✅ Mode réel seulement
      simulationEnabled: false,
      configuration: {
        totalSensors: this.sensorLocations.length,
        apiKeyConfigured: !!this.apiKey,
        uniqueSensors: new Set(this.sensorLocations.map(s => s.serialNo)).size
      },
      apiConnection: null,
      dataAccess: null,
      recommendations: []
    };
    
    // Test de connexion API
    diagnostic.apiConnection = await this.testAPIConnection();
    
    // Test d'accès aux données
    try {
      const testData = await this.tryFetchWorldData();
      diagnostic.dataAccess = {
        success: testData.length > 0,
        sensorsFound: testData.length,
        worldDataAccessible: this.apiStatus.worldDataAccess,
        serviceOnline: this.apiStatus.isOnline
      };
    } catch (error) {
      diagnostic.dataAccess = {
        success: false,
        error: error.message,
        serviceOnline: false
      };
    }
    
    // Recommandations
    if (!this.apiKey) {
      diagnostic.recommendations.push('Configurez AIRGRADIENT_API_KEY dans votre fichier .env');
    }
    
    if (!this.apiStatus.isOnline) {
      diagnostic.recommendations.push('Service AirGradient offline - vérifiez votre connexion et clé API');
    }
    
    if (diagnostic.dataAccess && diagnostic.dataAccess.sensorsFound === 0) {
      diagnostic.recommendations.push('Aucun capteur trouvé - vérifiez que vos capteurs envoient des données');
    }
    
    console.log('✅ Diagnostic terminé (mode réel seulement)');
    return diagnostic;
  }
}

module.exports = AirGradientService;