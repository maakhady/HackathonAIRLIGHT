// services/AuthService.js - Service d'authentification
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const User = require('../models/User');
const { isTokenBlacklisted } = require('../utils/blacklist');

class AuthService {
  
  // Générer un token JWT
  generateToken(userId) {
    return jwt.sign(
      { userId },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '1d' }
    );
  }
  
  // Vérifier un token JWT
  verifyToken(token) {
    try {
      return jwt.verify(token, process.env.JWT_SECRET);
    } catch (error) {
      return null;
    }
  }
  
  // Inscription avec email/password
  async register(userData) {
    try {
      const { firstName, lastName, email, password, role = 'user' } = userData;
      
      // Vérifier si l'utilisateur existe déjà
      const existingUser = await User.findOne({ email });
      if (existingUser) {
        return { 
          success: false, 
          message: 'Un utilisateur avec cet email existe déjà' 
        };
      }
      
      // Créer le nouvel utilisateur
      const user = new User({
        firstName,
        lastName,
        email,
        password,
        role
      });
      
      await user.save();
      
      // Générer le token
      const token = this.generateToken(user._id);
      
      return {
        success: true,
        message: 'Inscription réussie',
        user: {
          id: user._id,
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email,
          role: user.role
        },
        token
      };
      
    } catch (error) {
      console.error('❌ Erreur inscription:', error.message);
      return {
        success: false,
        message: 'Erreur lors de l\'inscription'
      };
    }
  }
  
  // Connexion avec email/password
  async login(email, password) {
    try {
      // Trouver l'utilisateur
      const user = await User.findOne({ email, isActive: true });
      if (!user) {
        return {
          success: false,
          message: 'Email ou mot de passe incorrect'
        };
      }
      
      // Vérifier le mot de passe
      const isPasswordValid = await user.comparePassword(password);
      if (!isPasswordValid) {
        return {
          success: false,
          message: 'Email ou mot de passe incorrect'
        };
      }
      
      // Mettre à jour la dernière connexion
      user.lastLogin = new Date();
      await user.save();
      
      // Générer le token
      const token = this.generateToken(user._id);
      
      return {
        success: true,
        message: 'Connexion réussie',
        user: {
          id: user._id,
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email,
          role: user.role,
          avatar: user.avatar
        },
        token
      };
      
    } catch (error) {
      console.error('❌ Erreur connexion:', error.message);
      return {
        success: false,
        message: 'Erreur lors de la connexion'
      };
    }
  }
  
  // Connexion ou création avec Google
  async googleAuth(googleData) {
    try {
      const { googleId, email, firstName, lastName, avatar } = googleData;
      
      // Chercher utilisateur existant
      let user = await User.findOne({ 
        $or: [
          { googleId },
          { email }
        ]
      });
      
      if (user) {
        // Utilisateur existe - mettre à jour les infos Google si nécessaire
        if (!user.googleId) {
          user.googleId = googleId;
          user.avatar = avatar;
          await user.save();
        }
        
        // Mettre à jour la dernière connexion
        user.lastLogin = new Date();
        await user.save();
        
      } else {
        // Créer nouvel utilisateur
        user = new User({
          firstName,
          lastName,
          email,
          googleId,
          avatar,
          role: 'user',
          lastLogin: new Date()
        });
        
        await user.save();
      }
      
      // Générer le token
      const token = this.generateToken(user._id);
      
      return {
        success: true,
        message: 'Connexion Google réussie',
        user: {
          id: user._id,
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email,
          role: user.role,
          avatar: user.avatar
        },
        token
      };
      
    } catch (error) {
      console.error('❌ Erreur connexion Google:', error.message);
      return {
        success: false,
        message: 'Erreur lors de la connexion Google'
      };
    }
  }
  
  // Obtenir utilisateur par token
  async getUserByToken(token) {
    try {
      const decoded = this.verifyToken(token);
      if (!decoded) {
        return null;
      }
      
      const user = await User.findById(decoded.userId).select('-password');
      return user;
      
    } catch (error) {
      console.error('❌ Erreur récupération utilisateur:', error.message);
      return null;
    }
  }
  
  // Générer token de reset password
  async generateResetToken(email) {
    try {
      const user = await User.findOne({ email, isActive: true });
      if (!user) {
        return {
          success: false,
          message: 'Aucun utilisateur trouvé avec cet email'
        };
      }
      
      // Générer token de reset
      const resetToken = Math.floor(100000 + Math.random() * 900000).toString();
      const resetTokenExpires = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes
      
      user.resetPasswordToken = resetToken;
      user.resetPasswordExpires = resetTokenExpires;
      await user.save();
      
      return {
        success: true,
        resetToken,
        user: {
          email: user.email,
          firstName: user.firstName
        }
      };
      
    } catch (error) {
      console.error('❌ Erreur génération token reset:', error.message);
      return {
        success: false,
        message: 'Erreur lors de la génération du token'
      };
    }
  }
  
  // Reset password avec token
  async resetPassword(resetToken, newPassword) {
    try {
      const user = await User.findOne({
        resetPasswordToken: resetToken,
        resetPasswordExpires: { $gt: new Date() },
        isActive: true
      });
      
      if (!user) {
        return {
          success: false,
          message: 'Token invalide ou expiré'
        };
      }
      
      // Mettre à jour le mot de passe
      user.password = newPassword;
      user.resetPasswordToken = undefined;
      user.resetPasswordExpires = undefined;
      await user.save();
      
      return {
        success: true,
        message: 'Mot de passe réinitialisé avec succès'
      };
      
    } catch (error) {
      console.error('❌ Erreur reset password:', error.message);
      return {
        success: false,
        message: 'Erreur lors de la réinitialisation'
      };
    }
  }
  
  // Changer mot de passe
  async changePassword(userId, currentPassword, newPassword, confirmNewPassword) {
  try {
    const user = await User.findById(userId);
    if (!user) {
      return {
        success: false,
        message: 'Utilisateur non trouvé'
      };
    }

    // Vérifier le mot de passe actuel
    const isCurrentPasswordValid = await user.comparePassword(currentPassword);
    if (!isCurrentPasswordValid) {
      return {
        success: false,
        message: 'Mot de passe actuel incorrect'
      };
    }

    // Vérifier que les deux nouveaux mots de passe correspondent
    if (newPassword !== confirmNewPassword) {
      return {
        success: false,
        message: 'Les nouveaux mots de passe ne correspondent pas'
      };
    }

    // Mettre à jour le mot de passe
    user.password = newPassword;
    await user.save();

    return {
      success: true,
      message: 'Mot de passe modifié avec succès'
    };

  } catch (error) {
    console.error('❌ Erreur changement password:', error.message);
    return {
      success: false,
      message: 'Erreur lors du changement de mot de passe'
    };
  }
}

  
  // Vérifier si utilisateur est admin
  isAdmin(user) {
    return user && user.role === 'admin';
  }
  
  // Middleware d'authentification
  authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN
    
    if (!token) {
      return res.status(401).json({ message: 'Token d\'accès requis' });
    }


    if (isTokenBlacklisted(token)) {
    return res.status(403).json({ message: 'Token révoqué. Veuillez vous reconnecter.' });
    }
    
    const decoded = this.verifyToken(token);
    if (!decoded) {
      return res.status(403).json({ message: 'Token invalide' });
    }
    
    req.userId = decoded.userId;
    next();
  }
  
  // Middleware admin
  requireAdmin(req, res, next) {
    this.authenticateToken(req, res, async () => {
      try {
        const user = await User.findById(req.userId);
        if (!this.isAdmin(user)) {
          return res.status(403).json({ message: 'Accès admin requis' });
        }
        req.user = user;
        next();
      } catch (error) {
        res.status(500).json({ message: 'Erreur vérification admin' });
      }
    });
  }
}

module.exports = AuthService;