// middleware/alertMiddleware.js - Middleware pour notifications temps réel
const { Server } = require('socket.io');
const Alert = require('../models/Alert');

class AlertMiddleware {
  constructor() {
    this.io = null;
    this.connectedClients = new Map();
  }

  // Initialiser Socket.IO
  initialize(server) {
    this.io = new Server(server, {
      cors: {
        origin: process.env.CORS_ORIGIN?.split(',') || ['http://localhost:3001'],
        methods: ['GET', 'POST'],
        credentials: true
      },
      path: '/socket.io'
    });

    this.setupEventHandlers();
    console.log('✅ WebSocket initialisé pour les alertes temps réel');
  }

  // Configuration des gestionnaires d'événements
  setupEventHandlers() {
    this.io.on('connection', (socket) => {
      console.log(`🔌 Client connecté: ${socket.id}`);

      // Authentification du client
      socket.on('authenticate', async (token) => {
        try {
          // Ici vous pourriez vérifier le token JWT
          // const user = await authService.getUserByToken(token);
          
          this.connectedClients.set(socket.id, {
            socketId: socket.id,
            // userId: user?.id,
            connectedAt: new Date()
          });

          socket.emit('authenticated', { success: true });
          
          // Envoyer les alertes actives au client qui vient de se connecter
          const activeAlerts = await Alert.find({ isActive: true })
            .sort({ createdAt: -1 })
            .limit(20);
          
          socket.emit('active_alerts', activeAlerts);

        } catch (error) {
          console.error('❌ Erreur authentification WebSocket:', error.message);
          socket.emit('authenticated', { success: false, message: 'Token invalide' });
        }
      });

      // Rejoindre une salle pour un capteur spécifique
      socket.on('subscribe_sensor', (sensorId) => {
        socket.join(`sensor_${sensorId}`);
        console.log(`📡 Client ${socket.id} abonné au capteur ${sensorId}`);
      });

      // Quitter la salle d'un capteur
      socket.on('unsubscribe_sensor', (sensorId) => {
        socket.leave(`sensor_${sensorId}`);
        console.log(`📡 Client ${socket.id} désabonné du capteur ${sensorId}`);
      });

      // Gestion de la déconnexion
      socket.on('disconnect', () => {
        this.connectedClients.delete(socket.id);
        console.log(`🔌 Client déconnecté: ${socket.id}`);
      });

      // Ping pour maintenir la connexion
      socket.on('ping', () => {
        socket.emit('pong');
      });
    });
  }

  // Diffuser une nouvelle alerte à tous les clients connectés
  broadcastAlert(alert) {
    if (!this.io) return;

    try {
      // Diffuser à tous les clients connectés
      this.io.emit('new_alert', {
        id: alert._id,
        sensorId: alert.sensorId,
        alertType: alert.alertType,
        severity: alert.severity,
        message: alert.message,
        data: alert.data,
        createdAt: alert.createdAt,
        timestamp: new Date()
      });

      // Diffuser aux clients abonnés à ce capteur spécifique
      this.io.to(`sensor_${alert.sensorId}`).emit('sensor_alert', {
        id: alert._id,
        alertType: alert.alertType,
        severity: alert.severity,
        message: alert.message,
        data: alert.data,
        createdAt: alert.createdAt
      });

      console.log(`📢 Alerte diffusée: ${alert.severity} - ${alert.message}`);

    } catch (error) {
      console.error('❌ Erreur diffusion alerte:', error.message);
    }
  }

  // Diffuser la résolution d'une alerte
  broadcastAlertResolution(alertId, resolvedBy) {
    if (!this.io) return;

    try {
      this.io.emit('alert_resolved', {
        alertId,
        resolvedBy,
        resolvedAt: new Date()
      });

      console.log(`✅ Résolution d'alerte diffusée: ${alertId}`);

    } catch (error) {
      console.error('❌ Erreur diffusion résolution:', error.message);
    }
  }

  // Obtenir les statistiques de connexion
  getConnectionStats() {
    return {
      connectedClients: this.connectedClients.size,
      clients: Array.from(this.connectedClients.values())
    };
  }

  // Envoyer un message personnalisé à un client spécifique
  sendToClient(socketId, event, data) {
    if (!this.io) return;

    try {
      this.io.to(socketId).emit(event, data);
    } catch (error) {
      console.error(`❌ Erreur envoi message client ${socketId}:`, error.message);
    }
  }

  // Diffuser des statistiques système
  broadcastSystemStats(stats) {
    if (!this.io) return;

    try {
      this.io.emit('system_stats', {
        ...stats,
        timestamp: new Date()
      });
    } catch (error) {
      console.error('❌ Erreur diffusion stats système:', error.message);
    }
  }
}

// Instance singleton
const alertMiddleware = new AlertMiddleware();

// Middleware Express pour ajouter la référence à AlertMiddleware
const injectAlertMiddleware = (req, res, next) => {
  req.alertMiddleware = alertMiddleware;
  next();
};

// Fonction utilitaire pour déclencher une alerte depuis n'importe où
const triggerAlert = (alert) => {
  alertMiddleware.broadcastAlert(alert);
};

// Fonction utilitaire pour déclencher la résolution d'une alerte
const triggerAlertResolution = (alertId, resolvedBy) => {
  alertMiddleware.broadcastAlertResolution(alertId, resolvedBy);
};

module.exports = {
  AlertMiddleware: alertMiddleware,
  injectAlertMiddleware,
  triggerAlert,
  triggerAlertResolution
};