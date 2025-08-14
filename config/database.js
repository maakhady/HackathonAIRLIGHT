// config/database.js - Configuration MongoDB pour AirLight
const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    
    console.log(`MongoDB connecté: ${conn.connection.host}`);
    console.log(`Base de données: ${conn.connection.name}`);
    
    // Créer les index après connexion
    await createIndexes();
    
    return conn;
    
  } catch (error) {
    console.error('Erreur connexion MongoDB:', error.message);
    process.exit(1);
  }
};

// Créer les index pour optimiser les requêtes
const createIndexes = async () => {
  try {
    const db = mongoose.connection.db;
    
    console.log('Création des index...');
    
    // Index pour SensorData
    await db.collection('sensordatas').createIndex({ sensorId: 1, timestamp: -1 });
    await db.collection('sensordatas').createIndex({ timestamp: -1 });
    await db.collection('sensordatas').createIndex({ 'location.city': 1 });
    await db.collection('sensordatas').createIndex({ qualityLevel: 1 });
    
    // Index pour Predictions
    await db.collection('predictions').createIndex({ sensorId: 1, createdAt: -1 });
    await db.collection('predictions').createIndex({ predictionFor: 1 });
    
    // Index pour Alerts
    await db.collection('alerts').createIndex({ sensorId: 1, isActive: 1 });
    await db.collection('alerts').createIndex({ isActive: 1, createdAt: -1 });
    
    // Index pour Users
    await db.collection('users').createIndex({ email: 1 });
    await db.collection('users').createIndex({ googleId: 1 });
    
    console.log('Index créés avec succès');
    
  } catch (error) {
    console.error('Erreur création index:', error.message);
  }
};

// Gestion des événements de connexion
mongoose.connection.on('connected', () => {
  console.log('Mongoose connecté à MongoDB');
});

mongoose.connection.on('error', (err) => {
  console.error('Erreur Mongoose:', err);
});

mongoose.connection.on('disconnected', () => {
  console.log('Mongoose déconnecté');
});

// Fermeture propre de la connexion
process.on('SIGINT', async () => {
  try {
    await mongoose.connection.close();
    console.log('Connexion MongoDB fermée');
    process.exit(0);
  } catch (error) {
    console.error('Erreur fermeture MongoDB:', error);
    process.exit(1);
  }
});

module.exports = connectDB;