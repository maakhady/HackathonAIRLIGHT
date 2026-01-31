// test-predictions-api-fixed.js - CORRIGÉ avec la bonne route
const axios = require('axios');

const sensorId = 'd83bda1a182c'; // Votre capteur
const baseUrl = 'http://localhost:3000';

async function testPredictionsAPI() {
  console.log('🧪 Test de l\'API de prédictions (ROUTE CORRIGÉE)\n');
  
  try {
    // ✅ CORRECTION : Utiliser /predictions/:sensorId avec query params
    console.log('📡 Test 1: GET /predictions/:sensorId?type=future&hours=168');
    const response = await axios.get(`${baseUrl}/predictions/${sensorId}`, {
      params: {
        type: 'future',
        hours: 168
      }
    });
    
    console.log('✅ Réponse reçue:');
    console.log(`   - Nombre de prédictions: ${response.data.data?.length || 0}`);
    console.log(`   - Max hours ahead: ${response.data.maxHoursAhead || 'N/A'}`);
    
    if (response.data.data && response.data.data.length > 0) {
      const predictions = response.data.data;
      
      // Afficher les 5 premières prédictions
      console.log('\n📊 Les 5 premières prédictions:');
      predictions.slice(0, 5).forEach((pred, index) => {
        const date = new Date(pred.predictionFor);
        console.log(`   ${index + 1}. ${date.toLocaleString('fr-FR')} → PM2.5: ${pred.predictedPM25?.toFixed(1) || 'N/A'}, AQI: ${pred.predictedAQI?.toFixed(0) || 'N/A'}`);
      });
      
      // Afficher les 5 dernières prédictions
      console.log('\n📊 Les 5 dernières prédictions:');
      predictions.slice(-5).forEach((pred, index) => {
        const date = new Date(pred.predictionFor);
        console.log(`   ${index + 1}. ${date.toLocaleString('fr-FR')} → PM2.5: ${pred.predictedPM25?.toFixed(1) || 'N/A'}, AQI: ${pred.predictedAQI?.toFixed(0) || 'N/A'}`);
      });
      
      // Vérifier la plage de dates
      const firstDate = new Date(predictions[0].predictionFor);
      const lastDate = new Date(predictions[predictions.length - 1].predictionFor);
      const hoursDiff = (lastDate - firstDate) / (1000 * 60 * 60);
      
      console.log(`\n⏰ Plage temporelle:`);
      console.log(`   - Début: ${firstDate.toLocaleString('fr-FR')}`);
      console.log(`   - Fin: ${lastDate.toLocaleString('fr-FR')}`);
      console.log(`   - Durée: ${Math.round(hoursDiff)} heures`);
      
      // Vérifier si les prédictions changent
      const uniquePM25 = new Set(predictions.map(p => Math.round(p.predictedPM25 * 10) / 10));
      console.log(`\n🔍 Analyse des valeurs:`);
      console.log(`   - Valeurs PM2.5 uniques: ${uniquePM25.size}`);
      console.log(`   - Min PM2.5: ${Math.min(...predictions.map(p => p.predictedPM25)).toFixed(1)}`);
      console.log(`   - Max PM2.5: ${Math.max(...predictions.map(p => p.predictedPM25)).toFixed(1)}`);
      console.log(`   - Moyenne PM2.5: ${(predictions.reduce((sum, p) => sum + p.predictedPM25, 0) / predictions.length).toFixed(1)}`);
      
      // Diagnostic
      if (uniquePM25.size <= 3) {
        console.log('\n❌ PROBLÈME DÉTECTÉ: Les prédictions sont presque identiques !');
        console.log('   → Solution: Régénérer les prédictions avec POST /predictions/:sensorId/generate');
      } else if (hoursDiff < 24) {
        console.log('\n⚠️ PROBLÈME: Seulement quelques heures de prédictions disponibles');
        console.log(`   → Attendu: 168 heures (7 jours)`);
        console.log(`   → Trouvé: ${Math.round(hoursDiff)} heures`);
        console.log('   → Solution: Régénérer avec hoursAhead=168');
      } else {
        console.log('\n✅ Les prédictions semblent correctes');
      }
      
      // Test avec différentes périodes
      console.log('\n🧪 Test des différentes périodes:');
      
      const periods = [24, 48, 72, 168];
      for (const hours of periods) {
        const resp = await axios.get(`${baseUrl}/predictions/${sensorId}`, {
          params: { type: 'future', hours }
        });
        console.log(`   - ${hours}h: ${resp.data.count} prédictions`);
      }
      
    } else {
      console.log('❌ Aucune prédiction trouvée !');
      console.log('   → Solution: Générer des prédictions avec POST /predictions/:sensorId/generate');
    }
    
  } catch (error) {
    console.error('❌ Erreur:', error.message);
    if (error.response) {
      console.log('   Status:', error.response.status);
      console.log('   Data:', JSON.stringify(error.response.data, null, 2));
    }
  }
  
  console.log('\n' + '='.repeat(70));
  console.log('💡 COMMANDES UTILES:');
  console.log('='.repeat(70));
  console.log('\n1️⃣ Vérifier les prédictions existantes:');
  console.log(`   curl "http://localhost:3000/predictions/${sensorId}?type=future&hours=168"`);
  
  console.log('\n2️⃣ Générer de nouvelles prédictions (168h = 7 jours):');
  console.log(`   curl -X POST http://localhost:3000/predictions/${sensorId}/generate \\`);
  console.log(`        -H "Content-Type: application/json" \\`);
  console.log(`        -H "Authorization: Bearer VOTRE_TOKEN" \\`);
  console.log(`        -d '{"hoursAhead": 168}'`);
  
  console.log('\n3️⃣ Tester différentes périodes:');
  console.log(`   curl "http://localhost:3000/predictions/${sensorId}?type=future&hours=24"`);
  console.log(`   curl "http://localhost:3000/predictions/${sensorId}?type=future&hours=72"`);
  
  console.log('\n' + '='.repeat(70));
}

testPredictionsAPI();