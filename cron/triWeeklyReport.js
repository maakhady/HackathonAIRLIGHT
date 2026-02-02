const cron = require('node-cron');
const TriWeeklyReportService = require('../services/TriWeeklyReportService');

let job = null;
let lastRun = null;
let isRunning = false;

const scheduleTriWeeklyReport = () => {
  if (job) {
    console.log('⚠️ Cron tri-weekly report already running');
    return;
  }

  // Tous les 3 jours à 20h00 (heure Dakar)
  job = cron.schedule('0 20 */3 * *', async () => {
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

  console.log('✅ Cron tri-weekly report configuré : tous les 3 jours à 20h00 (Dakar)');
  
  // Calculer le prochain run
  const now = new Date();
  const next = new Date(now);
  next.setHours(20, 0, 0, 0);
  
  if (now.getHours() >= 20) {
    next.setDate(next.getDate() + 3);
  }
  
  console.log(`📅 Prochain envoi prévu : ${next.toLocaleString('fr-FR', { timeZone: 'Africa/Dakar' })}`);
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
    schedule: 'Tous les 3 jours à 20h00 (Dakar)',
    lastRun,
    timezone: 'Africa/Dakar'
  };
};

module.exports = { 
  scheduleTriWeeklyReport, 
  stopTriWeeklyReport,
  getStatus
};