// services/AirGradientService.js - VERSION DEBUG + FIX MATCHING
const axios = require('axios');

class AirGradientService {
  constructor() {
    this.baseURL = 'https://api.airgradient.com/public/api/v1';
    this.apiKey = process.env.AIRGRADIENT_API_KEY;
    
    this.sensorLocations = [
      { 
        serialNo: 'd83bda1d43d8', 
        serialNumeric: parseInt('d83bda1d43d8', 16),
        locationId: 164928,
        name: 'Ecole Supérieure Multinationale des Télécommunications (ESMT)', 
        city: 'Dakar',
        country: 'SN',
        coordinates: { lat: 14.700509233537487, lng: -17.450791143151584 }
      },
      { 
        serialNo: 'd83bda1ca05c', 
        serialNumeric: parseInt('d83bda1ca05c', 16),
        locationId: 168405,
        name: 'Mairie Tivaoune Diacksao', 
        city: 'Dakar',
        country: 'SN',
        coordinates: { lat: 14.7469647, lng: -17.3649319 }
      },
      
      { 
        serialNo: 'd83bda1ae490', 
        serialNumeric: parseInt('d83bda1ae490', 16),
        locationId: 90106,
        name: 'Ecole Elémentaire Ndiangué, Richard-Toll', 
        city: 'Richard-Toll',
        country: 'SN',
        coordinates: { lat: 16.4617, lng: -15.7014 }
      },
      { 
        serialNo: '588c8126653c', 
        serialNumeric: parseInt('588c8126653c', 16),
        locationId: 168371,
        name: 'Diaksao, Ecole Mbaye Diouf', 
        city: 'Dakar',
        country: 'SN',
        coordinates: { lat: 14.7537687, lng: -17.3715799 }
      },
      { 
        serialNo: '34b7daa1e7f4', 
        serialNumeric: parseInt('34b7daa1e7f4', 16),
        locationId: 151722,
        name: 'Lycée Cheikh Mouhamadou Moustapha Mbacké, Diourbel', 
        city: 'Diourbel',
        country: 'SN',
        coordinates: { lat: 14.6616754, lng: -16.2341494 }
      },
      { 
        serialNo: 'd83bda1a3268', 
        serialNumeric: parseInt('d83bda1a3268', 16),
        locationId: 168377,
        name: 'Lycée Malick Sy', 
        city: 'Thiès',
        country: 'SN',
        coordinates: { lat: 14.7843856, lng: -16.9421245 }      
      },
      { 
        serialNo: 'd83bda1c8dec', 
        serialNumeric: parseInt('d83bda1c8dec', 16),
        locationId: 176743,
        name: 'Hôpital Youssou Mbarguane', 
        city: 'Rufisque',
        country: 'SN',
        coordinates: { lat: 14.725899, lng: -17.259361 }
      },
      { 
        serialNo: 'd83bda1c49d8', 
        serialNumeric: parseInt('d83bda1c49d8', 16),
        locationId: 168391,
        name: 'Cem Guinaw Rails', 
        city: 'Saint-Louis',
        country: 'SN',
        coordinates: { lat: 16.0326307, lng: -16.4843916 }
      },
      { 
        serialNo: '588c81266ba0', 
        serialNumeric: parseInt('588c81266ba0', 16),
        locationId: 168369,
        name: 'Ecole Publique Médina Gana Sarr, Mbeubeuss', 
        city: 'Keur Massar',
        country: 'SN',
        coordinates: { lat: 14.7920809, lng: -17.3125511 }
      },
      { 
        serialNo: 'd83bda1d5b18', 
        serialNumeric: parseInt('d83bda1d5b18', 16),
        locationId: 168381,
        name: 'École Seydina Issa Laye B, Cambérène', 
        city: 'Dakar',
        country: 'SN',
        coordinates: { lat: 14.7668852, lng: -17.4357236 }
      },
      { 
        serialNo: 'd83bda1a182c', 
        serialNumeric: parseInt('d83bda1a182c', 16),
        locationId: 168395,
        name: 'Complexe Scolaire Limamoulaye', 
        city: 'Dakar',
        country: 'SN',
        coordinates: { lat: 14.7741435, lng: -17.3578561 }
      },
      { 
        serialNo: 'd83bda1d7598',
        serialNumeric: parseInt('d83bda1d7598', 16),
        locationId: 168406, 
        name: 'Lycée Ahoune Sané, Bignona', 
        city: 'Ziguinchor',
        country: 'SN',
        coordinates: { lat: 12.8098094, lng: -16.2287692 }
      },
      {
        serialNo: 'ccba97e1d91c',
        serialNumeric: parseInt('ccba97e1d91c', 16),
        locationId: 168372,
        name: 'Université Amadou Mahtar Mbow (UAM)',
        city: 'Diamniadio',
        country: 'SN',
        coordinates: { lat: 14.7343814, lng: -17.2008171 }
      }
    ];
    
    this.sensorLocations = this.sensorLocations.filter((sensor, index, self) =>
      index === self.findIndex(s => s.serialNo === sensor.serialNo)
    );
    
    this.apiStatus = {
      worldDataAccess: null,
      individualAccess: null,
      lastChecked: null,
      isOnline: false
    };
    
    console.log(`* Service AirGradient initialisé avec ${this.sensorLocations.length} capteurs uniques du Sénégal`);
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
      
      try {
        const response = await axios.get(`${this.baseURL}/world/locations/measures/current`, {
          headers: this.getHeaders(),
          params: this.getAuthParams(),
          timeout: 15000
        });
        
        console.log('✅ API accessible');
        this.apiStatus.isOnline = true;
        this.apiStatus.worldDataAccess = true;
        console.log(`✅ Accès données mondiales: ${response.data?.length || 0} mesures`);
        
        this.apiStatus.lastChecked = new Date();
        
        return { 
          success: true, 
          status: 200,
          worldDataAccess: true,
          isOnline: true,
          sensorsConfigured: this.sensorLocations.length,
          totalMeasures: response.data?.length || 0,
          message: 'API complètement accessible'
        };
        
      } catch (apiError) {
        this.apiStatus.isOnline = false;
        this.apiStatus.worldDataAccess = false;
        
        if (apiError.response?.status === 401) {
          console.log('❌ Erreur 401: Token invalide ou manquant');
          return {
            success: false,
            error: 'Authentication failed',
            status: 401,
            message: 'Vérifiez votre token AIRGRADIENT_API_KEY'
          };
        } else if (apiError.response?.status === 404) {
          console.log('❌ Erreur 404: Aucune donnée disponible');
          return {
            success: false,
            error: 'No data available',
            status: 404
          };
        } else {
          console.log(`❌ Erreur API: ${apiError.response?.status || apiError.message}`);
          return {
            success: false,
            error: apiError.message,
            status: apiError.response?.status
          };
        }
      }
      
    } catch (error) {
      this.apiStatus.isOnline = false;
      return { 
        success: false, 
        error: error.message,
        isOnline: false
      };
    }
  }
  
  async fetchRealAirGradientData() {
    try {
      if (!this.apiKey) {
        console.log(' Pas de clé API configurée - aucune donnée disponible');
        return [];
      }

      console.log(' Tentative de récupération des données réelles...');
      
      const endpoint = `${this.baseURL}/world/locations/measures/current`;

      try {
        console.log(`🔗 Appel API: ${endpoint}`);
        const response = await axios.get(endpoint, {
          headers: this.getHeaders(),
          params: this.getAuthParams(),
          timeout: 15000
        });

        if (response.data && Array.isArray(response.data) && response.data.length > 0) {
          console.log(`✅ ${response.data.length} mesures récupérées depuis l'API`);
          
          let processed = this.processRealData(response.data);
          
          // ✅ NOUVEAU : Pour les capteurs offline, essayer l'endpoint individuel
          const offlineSensors = processed.filter(s => s.status === 'offline');
          
          if (offlineSensors.length > 0) {
            console.log(` Tentative récupération individuelle pour ${offlineSensors.length} capteur(s) offline...`);
            
            for (const offlineSensor of offlineSensors) {
              try {
                const sensor = this.sensorLocations.find(s => s.serialNo === offlineSensor.location.id);
                if (!sensor || !sensor.locationId) continue;
                
                const url = `${this.baseURL}/locations/${sensor.locationId}/measures/current`;
                const individualResponse = await axios.get(url, {
                  headers: this.getHeaders(),
                  params: this.getAuthParams(),
                  timeout: 10000
                });
                
                if (individualResponse.data) {
                  const data = Array.isArray(individualResponse.data) 
                    ? individualResponse.data[0] 
                    : individualResponse.data;
                  
                  const index = processed.findIndex(s => s.location.id === sensor.serialNo);
                  if (index !== -1) {
                    // ✅ Utiliser le champ 'offline' de l'API (plus fiable)
                    const isOnline = data.offline === false;
                    
                    if (isOnline) {
                      // Capteur vraiment online
                      processed[index] = {
                        location: offlineSensor.location,
                        data: [this.normalizeRealData(data)],
                        status: 'online'
                      };
                      console.log(`✅ ${sensor.name} - PM2.5: ${data.pm02 !== null ? data.pm02 : 'N/A'}`);
                    } else {
                      // Capteur vraiment offline selon l'API
                      console.log(`⚠️  ${sensor.name} - OFFLINE (API offline=true)`);
                      // Garder status: 'offline' et data: null
                    }
                  }
                }
              } catch (error) {
                // Garder offline
                continue;
              }
              
              // Attendre un peu entre les requêtes
              await new Promise(resolve => setTimeout(resolve, 500));
            }
          }
          
          if (processed.length > 0) {
            this.apiStatus.isOnline = true;
            const onlineCount = processed.filter(s => s.status === 'online').length;
            const offlineCount = processed.filter(s => s.status === 'offline').length;
            console.log(`✅ Résultat final: ${onlineCount} en ligne, ${offlineCount} offline (${processed.length} capteurs au total)`);
            return processed;
          }
        }
      } catch (error) {
        if (error.response?.status === 401) {
          console.log(`❌ Erreur 401: Token invalide ou expiré`);
          console.log(`💡 Vérifiez votre AIRGRADIENT_API_KEY: ${this.apiKey?.substring(0, 8)}...`);
        } else if (error.response?.status === 404) {
          console.log(`❌ Erreur 404: Aucune donnée disponible`);
        } else {
          console.log(`❌ Erreur API: ${error.response?.status || error.message}`);
        }
        
        this.apiStatus.isOnline = false;
        return [];
      }

      console.log('❌ Aucune donnée accessible');
      this.apiStatus.isOnline = false;
      return [];
      
    } catch (error) {
      console.error('❌ Erreur récupération données:', error.message);
      return [];
    }
  }

  processRealData(worldData) {
    const realSensorsData = [];
    const foundLocationIds = new Set();

    console.log('🔍 Matching par locationId (pas de serial dans l\'API)');

    for (const measurement of worldData) {
      // ✅ Ignorer si pas de locationId
      if (!measurement.locationId) {
        continue;
      }

      // ✅ Éviter doublons
      if (foundLocationIds.has(measurement.locationId)) {
        continue;
      }

      // ✅ MATCH UNIQUEMENT PAR LOCATIONID
      const sensor = this.sensorLocations.find(s => 
        s.locationId && s.locationId === measurement.locationId
      );

      if (sensor) {
        foundLocationIds.add(measurement.locationId);
        
        // ✅ Vérifier le statut offline de l'API
        const isOnline = measurement.offline === false;
        
        realSensorsData.push({
          location: {
            id: sensor.serialNo,
            name: sensor.name,
            city: sensor.city,
            country: sensor.country,
            coordinates: sensor.coordinates
          },
          data: isOnline ? [this.normalizeRealData(measurement)] : null,
          status: isOnline ? 'online' : 'offline'
        });
        
        if (isOnline) {
          console.log(`✅ ${sensor.name} - PM2.5: ${measurement.pm02 !== null ? measurement.pm02 : 'N/A'} (locationId: ${measurement.locationId})`);
        } else {
          console.log(`⚠️  ${sensor.name} - OFFLINE selon API (locationId: ${measurement.locationId})`);
        }
      }
    }

    // ✅ Ajouter les capteurs non trouvés comme offline
    const missingSensors = this.sensorLocations.filter(s => 
      s.locationId && !foundLocationIds.has(s.locationId)
    );

    missingSensors.forEach(sensor => {
      realSensorsData.push({
        location: {
          id: sensor.serialNo,
          name: sensor.name,
          city: sensor.city,
          country: sensor.country,
          coordinates: sensor.coordinates
        },
        data: null,
        status: 'offline'
      });
      console.log(`⚠️  ${sensor.name} - OFFLINE (non trouvé dans API) (locationId: ${sensor.locationId})`);
    });

    const onlineCount = realSensorsData.filter(s => s.status === 'online').length;
    const offlineCount = realSensorsData.filter(s => s.status === 'offline').length;
    
    console.log(`📊 Total: ${onlineCount}/${this.sensorLocations.length} en ligne, ${offlineCount} offline`);
    
    return realSensorsData;
  }

  async fetchAllSensorsData() {
    console.log('🔄 Collecte des données de tous vos capteurs AirGradient...');
    
    if (this.apiStatus.worldDataAccess === null && this.apiStatus.lastChecked === null) {
      await this.testAPIConnection();
    }
    
    if (this.apiKey) {
      const realData = await this.fetchRealAirGradientData();
      
      if (realData && realData.length > 0) {
        const onlineCount = realData.filter(s => s.status === 'online').length;
        const offlineCount = realData.filter(s => s.status === 'offline').length;
        console.log(`✅ Synchronisation: ${onlineCount} capteur(s) en ligne, ${offlineCount} offline`);
        return realData;
      }
    }
    
    console.log('⚠️ Aucune donnée disponible pour cette synchronisation');
    return [];
  }
  
  getSensorLocations() {
    return this.sensorLocations.map(sensor => ({
      id: sensor.serialNo,
      serialNo: sensor.serialNo,
      serialNumeric: sensor.serialNumeric,
      locationId: sensor.locationId,
      name: sensor.name,
      city: sensor.city,
      country: sensor.country,
      coordinates: sensor.coordinates,
      type: sensor.type || 'outdoor'
    }));
  }
  
  async fetchSensorData(locationId) {
    try {
      if (!this.apiKey) {
        throw new Error('API key not configured');
      }

      const url = `${this.baseURL}/locations/${locationId}/measures/current`;
      const response = await axios.get(url, {
        headers: this.getHeaders(),
        params: this.getAuthParams(),
        timeout: 10000
      });

      return response.data;
    } catch (error) {
      if (error.response?.status === 401) {
        throw new Error('Authentication failed - Invalid API key');
      }
      throw error;
    }
  }
  
  normalizeRealData(apiData) {
    return {
      locationId: apiData.locationId,
      locationName: apiData.locationName,
      publicLocationName: apiData.publicLocationName,
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
      offline: apiData.offline || false,
      source: 'real_api'
    };
  }

  normalizeSerial(value) {
    if (value === undefined || value === null) return null;
    
    // ✅ Support pour les nombres (serialNumeric)
    let strValue = String(value);
    
    // ✅ Normalisation complète
    return strValue
      .toLowerCase()
      .replace(/^airgradient:/, '')
      .replace(/^0x/, '')
      .trim();
  }
  
  transformDataForStorage(rawData, locationInfo) {
    // ✅ FIX: Gérer data: null pour capteurs offline
    if (rawData === null) {
      return [];
    }
    
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
        source: 'airgradient_real'
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
      serviceOnline: this.apiStatus.isOnline,
      worldDataAccess: this.apiStatus.worldDataAccess,
      dataSource: this.apiStatus.isOnline ? 'real_only' : 'offline',
      lastApiCheck: this.apiStatus.lastChecked,
      lastUpdate: new Date().toISOString(),
      apiKeyConfigured: !!this.apiKey,
      simulationEnabled: false,
      sensorsDetailed: {
        'Dakar': this.sensorLocations.filter(s => s.city === 'Dakar').length,
        'Saint-Louis': this.sensorLocations.filter(s => s.city === 'Saint-Louis').length,
        'Thiès': this.sensorLocations.filter(s => s.city === 'Thiès').length,
        'Diourbel': this.sensorLocations.filter(s => s.city === 'Diourbel').length,
        'Richard-Toll': this.sensorLocations.filter(s => s.city === 'Richard-Toll').length,
        'Rufisque': this.sensorLocations.filter(s => s.city === 'Rufisque').length,
        'Keur Massar': this.sensorLocations.filter(s => s.city === 'Keur Massar').length,
        'Ziguinchor': this.sensorLocations.filter(s => s.city === 'Ziguinchor').length,
        'Bignona': this.sensorLocations.filter(s => s.city === 'Bignona').length
      }
    };
  }
  
  async runDiagnostic() {
    console.log('🔧 Diagnostic AirGradient...');
    
    const diagnostic = {
      timestamp: new Date().toISOString(),
      serviceMode: 'real_data_only',
      simulationEnabled: false,
      configuration: {
        totalSensors: this.sensorLocations.length,
        apiKeyConfigured: !!this.apiKey,
        apiKeyPrefix: this.apiKey ? this.apiKey.substring(0, 8) + '...' : 'N/A',
        uniqueSensors: new Set(this.sensorLocations.map(s => s.serialNo)).size
      },
      apiConnection: null,
      dataAccess: null,
      recommendations: []
    };
    
    diagnostic.apiConnection = await this.testAPIConnection();
    
    try {
      const testData = await this.fetchRealAirGradientData();
      const onlineCount = testData.filter(s => s.status === 'online').length;
      const offlineCount = testData.filter(s => s.status === 'offline').length;
      
      diagnostic.dataAccess = {
        success: testData.length > 0,
        sensorsTotal: this.sensorLocations.length,
        sensorsOnline: onlineCount,
        sensorsOffline: offlineCount,
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
    
    if (!this.apiKey) {
      diagnostic.recommendations.push('Configurez AIRGRADIENT_API_KEY dans votre fichier .env');
    }
    
    if (!this.apiStatus.isOnline) {
      diagnostic.recommendations.push('Service AirGradient offline - vérifiez votre connexion et token');
    }
    
    if (diagnostic.dataAccess && diagnostic.dataAccess.sensorsOnline === 0) {
      diagnostic.recommendations.push('Aucun capteur en ligne - vérifiez que vos capteurs envoient des données');
    }
    
    if (diagnostic.dataAccess && diagnostic.dataAccess.sensorsOffline > 0) {
      diagnostic.recommendations.push(`${diagnostic.dataAccess.sensorsOffline} capteur(s) offline - vérifiez l'état des capteurs`);
    }
    
    console.log('✅ Diagnostic terminé');
    return diagnostic;
  }
}

module.exports = AirGradientService;