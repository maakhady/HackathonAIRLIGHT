const { Resend } = require('resend');

// ✅ Resend utilisé à la place de nodemailer (Render bloque tous les ports SMTP)
const resend = new Resend(process.env.RESEND_API_KEY);

// Fonction pour envoyer un email via Resend
const sendEmail = async (to, subject, html) => {
  try {
    const { data, error } = await resend.emails.send({
      from: process.env.EMAIL_FROM || 'AirLight <onboarding@resend.dev>',
      to: to,
      subject: subject,
      html: html,
    });

    if (error) {
      console.error('Erreur Resend:', error);
      throw new Error(error.message);
    }

    console.log('✅ Email envoyé via Resend:', data.id);
    return { success: true, messageId: data.id };
  } catch (error) {
    console.error('❌ Erreur lors de l\'envoi de l\'email:', error);
    throw error;
  }
};

// Template HTML pour le code de récupération avec thème AirGradiant
const getPasswordResetTemplate = (code, userName) => {
  return `
    <!DOCTYPE html>
    <html lang="fr">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Réinitialisation de mot de passe - AirLight</title>
      <style>
        body {
          font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
          background-color: #f6f6f6;
          color: #3b3b3b;
          padding: 30px;
        }

        .email-wrapper {
          max-width: 600px;
          margin: auto;
          background: #ffffff;
          border-radius: 12px;
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.06);
          overflow: hidden;
        }

        .header {
          background-color: #0f72c9ff;
          color: white;
          text-align: center;
          padding: 30px;
        }

        .header .logo {
          font-size: 26px;
          font-weight: bold;
        }

        .header-title {
          margin-top: 5px;
          font-size: 18px;
          font-weight: 300;
        }

        .content {
          padding: 30px;
        }

        .greeting {
          font-size: 18px;
          margin-bottom: 20px;
        }

        .message {
          font-size: 16px;
          margin-bottom: 30px;
        }

        .code-section {
          background-color: #f0fafa;
          border: 1px solid #0f72c9ff;
          border-radius: 10px;
          padding: 25px;
          text-align: center;
          margin: 30px 0;
        }

        .code-label {
          font-size: 14px;
          text-transform: uppercase;
          color: #0f72c9ff;
          letter-spacing: 1px;
          margin-bottom: 10px;
        }

        .verification-code {
          font-family: 'Courier New', monospace;
          font-size: 32px;
          font-weight: bold;
          color: #0f72c9ff;
          letter-spacing: 6px;
        }

        .expiry-notice {
          margin-top: 15px;
          font-size: 14px;
          color: #e53e3e;
        }

        .security-notice {
          background-color: #fef5f5;
          border-left: 4px solid #e53e3e;
          padding: 20px;
          border-radius: 8px;
          margin-bottom: 20px;
        }

        .security-title {
          font-weight: bold;
          color: #c53030;
          margin-bottom: 10px;
        }

        .security-list {
          padding-left: 20px;
          color: #742a2a;
          font-size: 14px;
        }

        .support-text {
          text-align: center;
          margin-top: 25px;
          font-size: 15px;
          color: #4a5568;
        }

        .footer {
          background-color: #f6f6f6;
          text-align: center;
          padding: 20px;
          font-size: 13px;
          color: #888;
        }

        .footer strong {
          color: #3b3b3b;
        }
      </style>
    </head>
    <body>
      <div class="email-wrapper">
        <div class="header">
          <div class="logo">AirLight</div>
          <div class="header-title">Réinitialisation de mot de passe</div>
        </div>
        <div class="content">
          <div class="greeting">Bonjour ${userName || 'Utilisateur'} 👋</div>
          <div class="message">
            Vous avez demandé la réinitialisation de votre mot de passe. Voici votre code de vérification :
          </div>
          <div class="code-section">
            <div class="code-label">Code de vérification</div>
            <div class="verification-code">${code}</div>
            <div class="expiry-notice">⏱️ Expire dans 15 minutes</div>
          </div>
          <div class="security-notice">
            <div class="security-title">🛡️ Sécurité</div>
            <ul class="security-list">
              <li>Ne partagez jamais ce code</li>
              <li>Nous ne demandons jamais ce code</li>
              <li>Ignorez si vous n'avez pas fait cette demande</li>
            </ul>
          </div>
          <div class="support-text">
            Besoin d’aide ? Notre équipe vous accompagne 🚀
          </div>
        </div>
        <div class="footer">
          <div>
            <strong>© 2025 AirLight: "Innover pour un air plus sain au Sénégal : surveiller, alerter et éduquer.</strong><br>
            Généré le ${new Date().toLocaleDateString('fr-FR', { year: 'numeric', month: 'long', day: 'numeric' })}
          </div>
        </div>
      </div>
    </body>
    </html>
  `;
};


// Fonction spécifique pour envoyer le code de récupération
const sendPasswordResetCode = async (email, code, userName) => {
  const subject = 'Code de récupération - AirLight';
  const html = getPasswordResetTemplate(code, userName);
  
  return await sendEmail(email, subject, html);
};

// Test de la connexion email (vérifie que la clé Resend est définie)
const testEmailConnection = async () => {
  try {
    if (!process.env.RESEND_API_KEY) {
      throw new Error('RESEND_API_KEY non définie');
    }
    console.log('✅ Configuration Resend valide');
    return true;
  } catch (error) {
    console.error('❌ Erreur de configuration email:', error);
    return false;
  }
};
// ============= ✨ RAPPORT TRI-HEBDOMADAIRE AVEC TES COULEURS AQI =============

const getTriWeeklyReportTemplate = (data) => {
  
  // ✅ TES COULEURS AQI EXACTES
  const getAqiClass = (aqi) => {
    if (aqi <= 50) {
      return { 
        color: '#198754', 
        label: 'Bon',
        bg: 'rgba(25, 135, 84, 0.1)' 
      };
    } else if (aqi <= 100) {
      return { 
        color: '#ffe600', 
        label: 'Modéré',
        bg: 'rgba(255, 255, 0, 0.1)' 
      };
    } else if (aqi <= 150) {
      return { 
        color: '#ff7e00', 
        label: 'Sensible',
        bg: 'rgba(255, 126, 0, 0.1)' 
      };
    } else if (aqi <= 200) {
      return { 
        color: '#ff0000', 
        label: 'Mauvais',
        bg: 'rgba(255, 0, 0, 0.1)' 
      };
    } else if (aqi <= 300) {
      return { 
        color: '#8f3f97', 
        label: 'Très mauvais',
        bg: 'rgba(143, 63, 151, 0.1)' 
      };
    } else {
      return { 
        color: '#654321', 
        label: 'Dangereux',
        bg: 'rgba(101, 67, 33, 0.1)' 
      };
    }
  };

  const getOrdinal = (n) => (n === 1 ? 'er' : 'ème');
  // APP_URL est l'URL de prod — indépendant de FRONTEND_URL (qui peut être localhost en dev)
  const appUrl = process.env.APP_URL || 'https://airlight.netlify.app';

  return `
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AirLight - Rapport Tri-hebdomadaire</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    body {
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      background-color: #f6f6f6;
      padding: 20px;
      line-height: 1.6;
    }
    .email-wrapper {
      max-width: 650px;
      margin: 0 auto;
      background: #ffffff;
      border-radius: 12px;
      overflow: hidden;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.06);
    }
    .header {
      background-color: #0f72c9ff;
      color: white;
      padding: 40px 30px;
      text-align: center;
    }
    .header .logo {
      font-size: 32px;
      font-weight: bold;
      margin-bottom: 8px;
    }
    .header-title {
      font-size: 16px;
      color: rgba(255,255,255,0.9);
    }
    .content {
      padding: 30px;
    }
    .section {
      margin-bottom: 30px;
      padding-bottom: 30px;
      border-bottom: 2px solid #f1f5f9;
    }
    .section:last-child {
      border-bottom: none;
    }
    .section-title {
      font-size: 20px;
      color: #1e293b;
      margin-bottom: 15px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .aqi-card {
      background: linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%);
      border-radius: 12px;
      padding: 25px;
      text-align: center;
      margin-bottom: 20px;
    }
    .aqi-value {
      font-size: 48px;
      font-weight: bold;
      margin: 10px 0;
    }
    .aqi-label {
      font-size: 14px;
      color: #64748b;
      text-transform: uppercase;
      letter-spacing: 1px;
    }
    .aqi-badge {
      display: inline-block;
      padding: 6px 16px;
      border-radius: 20px;
      font-size: 14px;
      font-weight: 600;
      margin-top: 10px;
    }
    .trend {
      display: inline-block;
      padding: 4px 12px;
      border-radius: 20px;
      font-size: 14px;
      font-weight: 600;
      margin-top: 10px;
    }
    .trend-up {
      background: #fee2e2;
      color: #dc2626;
    }
    .trend-down {
      background: #dcfce7;
      color: #16a34a;
    }
    .stats-grid {
      display: flex;
      gap: 15px;
      margin-top: 20px;
    }
    .stat-box {
      flex: 1;
      text-align: center;
    }
    .stat-label {
      font-size: 12px;
      color: #64748b;
      margin-bottom: 5px;
    }
    .stat-value {
      font-size: 24px;
      font-weight: bold;
      margin-top: 5px;
    }
    .predictions {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin-top: 15px;
    }
    .prediction-day {
      flex: 1 1 calc(14% - 10px);
      min-width: 80px;
      background: #f8fafc;
      padding: 12px;
      border-radius: 8px;
      text-align: center;
      border: 2px solid #e2e8f0;
    }
    .prediction-day .day {
      font-size: 11px;
      color: #64748b;
      margin-bottom: 6px;
    }
    .prediction-day .value {
      font-size: 20px;
      font-weight: bold;
    }
    .city-rank {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 12px 15px;
      background: #f8fafc;
      border-radius: 8px;
      margin-bottom: 10px;
    }
    .city-rank .position {
      font-size: 24px;
      font-weight: bold;
      color: #64748b;
      width: 40px;
    }
    .city-rank .city-name {
      flex: 1;
      font-weight: 600;
      color: #1e293b;
    }
    .health-impact {
      background: #fef3c7;
      border-left: 4px solid #f59e0b;
      padding: 20px;
      border-radius: 8px;
      margin-top: 15px;
    }
    .recommendations {
      list-style: none;
      padding: 0;
    }
    .recommendations li {
      padding: 12px 15px;
      background: #f8fafc;
      margin-bottom: 8px;
      border-radius: 6px;
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .tip-box {
      background: linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%);
      border-radius: 12px;
      padding: 25px;
      margin-top: 15px;
    }
    .tip-box h4 {
      color: #065f46;
      margin-bottom: 12px;
      font-size: 18px;
    }
    .tip-box p {
      color: #047857;
      line-height: 1.8;
    }
    .btn {
      display: inline-block;
      padding: 12px 24px;
      background: #0f72c9ff;
      color: white !important;
      text-decoration: none;
      border-radius: 8px;
      font-weight: 600;
      margin-top: 15px;
    }
    .footer {
      background-color: #f6f6f6;
      text-align: center;
      padding: 20px;
      font-size: 13px;
      color: #888;
    }
    .footer a {
      color: #0f72c9ff;
      text-decoration: none;
    }
    @media (max-width: 600px) {
      .predictions, .stats-grid {
        flex-direction: column;
      }
      .header .logo {
        font-size: 24px;
      }
      .aqi-value {
        font-size: 36px;
      }
    }
  </style>
</head>
<body>
  <div class="email-wrapper">
    <div class="header">
      <div class="logo">🌬️ AirLight</div>
      <div class="header-title">Rapport qualité de l'air - ${data.period}</div>
    </div>

    <div class="content">
      <!-- Vue d'ensemble -->
      <div class="section">
        <div class="section-title">📊 Vue d'ensemble (${data.daysCount} jours)</div>
        
        <div class="aqi-card">
          <div class="aqi-label">Qualité de l'air moyenne à ${data.userCity}</div>
          <div class="aqi-value" style="color: ${getAqiClass(data.avgAqi).color}">
            ${Math.round(data.avgAqi)}
          </div>
          <div class="aqi-badge" style="background: ${getAqiClass(data.avgAqi).bg}; color: ${getAqiClass(data.avgAqi).color}; border: 2px solid ${getAqiClass(data.avgAqi).color};">
            ${getAqiClass(data.avgAqi).label}
          </div>
          
          ${data.trendPercentage !== 0 ? `
          <div class="trend ${data.trendPercentage > 0 ? 'trend-up' : 'trend-down'}">
            ${data.trendPercentage > 0 ? '↑' : '↓'} ${Math.abs(data.trendPercentage)}% vs période précédente
          </div>
          ` : ''}
        </div>

        <div class="stats-grid">
          <div class="stat-box">
            <div class="stat-label">MEILLEUR JOUR</div>
            <div class="stat-value" style="color: ${getAqiClass(data.bestDay.aqi).color};">
              ${Math.round(data.bestDay.aqi)}
            </div>
            <div class="stat-label" style="margin-top: 5px;">${data.bestDay.date}</div>
          </div>
          <div class="stat-box">
            <div class="stat-label">PIRE JOUR</div>
            <div class="stat-value" style="color: ${getAqiClass(data.worstDay.aqi).color};">
              ${Math.round(data.worstDay.aqi)}
            </div>
            <div class="stat-label" style="margin-top: 5px;">${data.worstDay.date}</div>
          </div>
        </div>

        ${data.alertsCount > 0 ? `
        <div style="background: rgba(255, 0, 0, 0.1); border-left: 4px solid #ff0000; padding: 15px; border-radius: 8px; margin-top: 20px;">
          <strong style="color: #ff0000;">🚨 ${data.alertsCount} alerte${data.alertsCount > 1 ? 's' : ''} déclenchée${data.alertsCount > 1 ? 's' : ''}</strong>
        </div>
        ` : ''}
      </div>

      <!-- Prévisions IA -->
      <div class="section">
        <div class="section-title">🔮 Prévisions IA (7 prochains jours)</div>

        ${data.predictionsUnavailable ? `
        <div style="background: #f1f5f9; border-left: 4px solid #94a3b8; padding: 20px; border-radius: 8px; text-align: center;">
          <div style="font-size: 24px; margin-bottom: 10px;">📡</div>
          <strong style="color: #475569; font-size: 16px;">Prédictions non disponibles pour le moment</strong>
          <p style="color: #64748b; margin-top: 8px; font-size: 14px;">
            Consultez le site pour suivre la qualité de l'air en temps réel.
          </p>
          <a href="${appUrl}" style="display: inline-block; margin-top: 12px; padding: 10px 20px; background: #0f72c9; color: white; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 14px;">
            🌐 Voir en temps réel
          </a>
        </div>
        ` : `
        <div class="predictions">
          ${data.predictions.map(pred => `
          <div class="prediction-day" style="border-color: ${getAqiClass(pred.aqi).color};">
            <div class="day">${pred.day}</div>
            <div class="value" style="color: ${getAqiClass(pred.aqi).color}">
              ${Math.round(pred.aqi)}
            </div>
            <div style="font-size: 11px; color: #64748b; margin-top: 5px;">
              ${getAqiClass(pred.aqi).label}
            </div>
          </div>
          `).join('')}
        </div>

        ${data.bestPredictionDay ? `
        <div style="background: rgba(25, 135, 84, 0.1); border-left: 4px solid #198754; padding: 15px; border-radius: 8px; margin-top: 15px;">
          <strong style="color: #198754;">💨 ${data.bestPredictionDay.message}</strong>
          <div style="font-size: 14px; color: #198754; margin-top: 8px;">
            🏃‍♂️ Meilleur moment pour sport : ${data.bestPredictionDay.bestTime}
          </div>
        </div>
        ` : ''}
        `}
      </div>

      <!-- Classement des villes -->
      <div class="section">
        <div class="section-title">🏙️ Classement des villes</div>
        
        <div style="margin-bottom: 20px;">
          <strong style="color: #198754;">✅ Air le plus pur</strong>
          ${data.topCities.slice(0, 3).map((city, i) => `
          <div class="city-rank">
            <div class="position">${i + 1}</div>
            <div class="city-name">${city.name}</div>
            <div style="font-size: 18px; font-weight: bold; color: ${getAqiClass(city.aqi).color}; padding: 4px 12px; border-radius: 6px; background: ${getAqiClass(city.aqi).bg};">
              ${Math.round(city.aqi)}
            </div>
          </div>
          `).join('')}
        </div>

        ${data.userCityRank ? `
        <div style="background: #dbeafe; padding: 15px; border-radius: 8px;">
          <strong>📍 Ta ville (${data.userCity})</strong>
          <div style="margin-top: 8px; font-size: 14px; color: #1e40af;">
            ${data.userCityRank.position}${getOrdinal(data.userCityRank.position)} sur ${data.userCityRank.total} villes
          </div>
        </div>
        ` : ''}
      </div>

      <!-- Impact santé -->
      <div class="section">
        <div class="section-title">💊 Impact santé</div>
        
        <div class="health-impact">
          <div style="font-size: 32px; margin-bottom: 10px;">🚬</div>
          <strong style="color: #92400e; font-size: 18px;">
            Équivalent : ${data.cigaretteEquivalent} cigarette${data.cigaretteEquivalent > 1 ? 's' : ''} passive${data.cigaretteEquivalent > 1 ? 's' : ''} sur ${data.daysCount} jours
          </strong>
          <div style="font-size: 14px; color: #78350f; margin-top: 10px;">
            😷 Temps passé dans air modéré ou pire : ${data.unhealthyHours}h
          </div>
        </div>

        <div style="margin-top: 20px;">
          <strong style="display: block; margin-bottom: 12px; color: #1e293b;">RECOMMANDATIONS</strong>
          <ul class="recommendations">
            ${data.recommendations.map(rec => `
            <li>
              <span>${rec.icon}</span>
              <span>${rec.text}</span>
            </li>
            `).join('')}
          </ul>
        </div>
      </div>

      <!-- Conseil pratique -->
      <div class="section">
        <div class="section-title">💡 Conseil de la semaine</div>
        
        <div class="tip-box">
          <h4>${data.tip.title}</h4>
          <p>${data.tip.content}</p>
          ${data.tip.action ? `
          <a href="${data.tip.action.link}" class="btn">
            ${data.tip.action.label}
          </a>
          ` : ''}
        </div>
      </div>

      <!-- CTA -->
      <div style="text-align: center; padding: 30px 0;">
        <a href="${appUrl}" class="btn">
          📊 Voir le tableau de bord complet
        </a>
      </div>
    </div>

    <!-- Footer -->
    <div class="footer">
      <p style="margin-bottom: 10px;">
        Vous recevez cet email car vous êtes abonné aux rapports AirLight.
      </p>
      <p style="font-size: 12px; color: #94a3b8;">
        © 2026 AirLight - Surveillance de la qualité de l'air au Sénégal<br>
        Généré le ${new Date().toLocaleDateString('fr-FR', { year: 'numeric', month: 'long', day: 'numeric' })}
      </p>
    </div>
  </div>
</body>
</html>
  `;
};

// Fonction pour envoyer le rapport tri-hebdomadaire
const sendTriWeeklyReport = async (email, reportData) => {
  const subject = `🌬️ AirLight - Rapport qualité de l'air (${reportData.period})`;
  const html = getTriWeeklyReportTemplate(reportData);
  
  return await sendEmail(email, subject, html);
};

module.exports = {
  sendEmail,
  sendPasswordResetCode,
  sendTriWeeklyReport,
  testEmailConnection
};

