// routes/auth.js - Routes d'authentification
const express = require('express');
const passport = require('passport');
const AuthService = require('../services/AuthService');
const { sendPasswordResetCode } = require('../config/email');
const { blacklistToken } = require('../utils/blacklist');


const router = express.Router();
const authService = new AuthService();

// Routes d'authentification classique (email/password)

// POST /auth/register - Inscription
router.post('/register', async (req, res) => {
  try {
    const result = await authService.register(req.body);
    
    if (result.success) {
      res.status(201).json(result);
    } else {
      res.status(400).json(result);
    }
    
  } catch (error) {
    console.error('❌ Erreur route register:', error.message);
    res.status(500).json({
      success: false,
      message: 'Erreur serveur'
    });
  }
});

// POST /auth/login - Connexion
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const result = await authService.login(email, password);
    
    if (result.success) {
      res.status(200).json(result);
    } else {
      res.status(401).json(result);
    }
    
  } catch (error) {
    console.error('❌ Erreur route login:', error.message);
    res.status(500).json({
      success: false,
      message: 'Erreur serveur'
    });
  }
});

// Routes Google OAuth

// GET /auth/google - Démarrer l'authentification Google
router.get('/google', 
  passport.authenticate('google', { 
    scope: ['profile', 'email'] 
  })
);

// GET /auth/google/callback - Callback Google OAuth
router.get('/google/callback',
  passport.authenticate('google', { 
    failureRedirect: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/login?error=google_auth_failed` 
  }),
  (req, res) => {
    try {
      // L'utilisateur est dans req.user (retourné par la stratégie)
      const { user, token } = req.user;
      
      // Rediriger vers le frontend avec le token
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
      res.redirect(`${frontendUrl}/auth/callback?token=${token}&user=${encodeURIComponent(JSON.stringify(user))}`);
      
    } catch (error) {
      console.error('❌ Erreur callback Google:', error.message);
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
      res.redirect(`${frontendUrl}/login?error=callback_error`);
    }
  }
);

// Routes utilitaires

// GET /auth/me - Obtenir l'utilisateur connecté
router.get('/me', authService.authenticateToken.bind(authService), async (req, res) => {
  try {
    const user = await authService.getUserByToken(req.headers.authorization?.split(' ')[1]);
    
    if (user) {
      res.json({
        success: true,
        user: {
          id: user._id,
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email,
          role: user.role,
          avatar: user.avatar
        }
      });
    } else {
      res.status(404).json({
        success: false,
        message: 'Utilisateur non trouvé'
      });
    }
    
  } catch (error) {
    console.error('❌ Erreur route me:', error.message);
    res.status(500).json({
      success: false,
      message: 'Erreur serveur'
    });
  }
});

// POST /auth/logout - Déconnexion (côté client principalement avec JWT)
router.post('/logout', (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (token) {
    blacklistToken(token);
  }

  res.json({
    success: true,
    message: 'Déconnexion réussie'
  });
});

// Routes de reset password

// POST /auth/forgot-password
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    const result = await authService.generateResetToken(email);

    if (result.success) {
      await sendPasswordResetCode(result.user.email, result.resetToken, result.user.firstName);

      res.json({
        success: true,
        message: 'Email de réinitialisation envoyé'
      });
    } else {
      res.status(404).json(result);
    }

  } catch (error) {
    console.error('❌ Erreur forgot password:', error.message);
    res.status(500).json({
      success: false,
      message: 'Erreur serveur'
    });
  }
});


// POST /auth/reset-password
router.post('/reset-password', async (req, res) => {
  try {
    const { token, password } = req.body;
    const result = await authService.resetPassword(token, password);
    
    if (result.success) {
      res.json(result);
    } else {
      res.status(400).json(result);
    }
    
  } catch (error) {
    console.error('❌ Erreur reset password:', error.message);
    res.status(500).json({
      success: false,
      message: 'Erreur serveur'
    });
  }
});

// POST /auth/change-password
router.post('/change-password', authService.authenticateToken.bind(authService), async (req, res) => {
  try {
    const { currentPassword, newPassword, confirmNewPassword } = req.body;
    const result = await authService.changePassword(req.userId, currentPassword, newPassword, confirmNewPassword);
    
    if (result.success) {
      res.json(result);
    } else {
      res.status(400).json(result);
    }
    
  } catch (error) {
    console.error('❌ Erreur change password:', error.message);
    res.status(500).json({
      success: false,
      message: 'Erreur serveur'
    });
  }
});

module.exports = router;