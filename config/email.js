const nodemailer = require('nodemailer');

// Configuration du transporteur email
const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: process.env.EMAIL_PORT,
  secure: false,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASSWORD,
  },
  tls: {
    rejectUnauthorized: false
  }
});

// Fonction pour envoyer un email
const sendEmail = async (to, subject, html) => {
  try {
    const mailOptions = {
      from: process.env.EMAIL_FROM,
      to: to,
      subject: subject,
      html: html,
    };

    const info = await transporter.sendMail(mailOptions);
    console.log('Email envoyé: ', info.messageId);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error('Erreur lors de l\'envoi de l\'email:', error);
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

// Test de la connexion email
const testEmailConnection = async () => {
  try {
    await transporter.verify();
    console.log('✅ Configuration email valide');
    return true;
  } catch (error) {
    console.error('❌ Erreur de configuration email:', error);
    return false;
  }
};

module.exports = {
  sendEmail,
  sendPasswordResetCode,
  testEmailConnection,
  transporter
};