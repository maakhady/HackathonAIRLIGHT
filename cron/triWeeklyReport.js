const cron = require('node-cron');
const TriWeeklyReportService = require('../services/TriWeeklyReportService');

let job = null;
let lastRun = null;
let isRunning = false;

// ⚠️ node-cron ne supporte pas les intervalles glissants de N jours.
// On tourne chaque jour à 20h et on vérifie si 7 jours se sont écoulés depuis le dernier envoi.
const INTERVAL_DAYS = 7;

const shouldRun = () => {
  if (!lastRun) return true;
  const diffMs = Date.now() - lastRun.getTime();
  return diffMs >= INTERVAL_DAYS * 24 * 60 * 60 * 1000;
};

const scheduleTriWeeklyReport = () => {
  if (job) {
    console.log('⚠️ Cron tri-weekly report already running');
    return;
  }

  // Vérification quotidienne à 20h (Dakar) — l'envoi n'a lieu que si 7 jours se sont écoulés
  job = cron.schedule('0 20 * * *', async () => {
    if (!shouldRun()) {
      console.log('⏭️ [CRON TRI-WEEKLY] Pas encore 7 jours depuis le dernier envoi, on passe.');
      return;
    }

    console.log('\n🕐 [CRON TRI-WEEKLY] Déclenchement rapport - ' + new Date().toLocaleString('fr-FR', { timeZone: 'Africa/Dakar' }));

    isRunning = true;
    lastRun = new Date();

    try {
      const result = await TriWeeklyReportService.generateAndSendReports();
      console.log(`✅ [CRON TRI-WEEKLY] ${result.successful}/${result.total} rapports envoyés`);
    } catch (error) {
      console.error('❌ [CRON TRI-WEEKLY] Erreur:', error.message);
    } finally {
      isRunning = false;
    }
  }, {
    scheduled: true,
    timezone: "Africa/Dakar"
  });

  console.log('✅ Cron rapport hebdomadaire configuré : vérification quotidienne à 20h00 (Dakar), envoi tous les 7 jours');
};

const stopTriWeeklyReport = () => {
  if (job) {
    job.stop();
    job = null;
    console.log('🛑 Cron tri-weekly report arrêté');
  }
};

const getStatus = () => {
  return {
    name: 'triWeeklyReport',
    isRunning,
    isScheduled: job !== null,
    schedule: 'Tous les 7 jours à 20h00 (Dakar)',
    lastRun,
    timezone: 'Africa/Dakar'
  };
};

module.exports = { 
  scheduleTriWeeklyReport, 
  stopTriWeeklyReport,
  getStatus
};