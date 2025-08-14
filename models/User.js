// models/User.js - Modèle User simplifié
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const UserSchema = new mongoose.Schema({
  firstName: {
    type: String,
    required: true,
    trim: true
  },
  lastName: {
    type: String,
    required: true,
    trim: true
  },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true
  },
  password: {
    type: String,
    required: function() {
      return !this.googleId; // Mot de passe requis seulement si pas de connexion Google
    }
  },
  role: {
    type: String,
    enum: ['admin', 'user'],
    default: 'user'
  },
  // Pour la connexion Google
  googleId: {
    type: String,
    sparse: true // Index sparse pour permettre les valeurs null
  },
  avatar: String, // URL de l'image de profil
  
  // Préférences notifications
  notifications: {
    email: { type: Boolean, default: true },
    push: { type: Boolean, default: true }
  },
  
  isActive: {
    type: Boolean,
    default: true
  },
  lastLogin: Date,
  
  // Pour reset password
  resetPasswordToken: String,
  resetPasswordExpires: Date
}, {
  timestamps: true
});



// Hash du mot de passe avant sauvegarde
UserSchema.pre('save', async function(next) {
  // Ne pas hasher si c'est une connexion Google sans mot de passe
  if (!this.password || !this.isModified('password')) return next();
  
  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// Méthode pour comparer les mots de passe
UserSchema.methods.comparePassword = async function(candidatePassword) {
  if (!this.password) return false; // Pas de mot de passe (connexion Google)
  return bcrypt.compare(candidatePassword, this.password);
};

// Méthode pour obtenir le nom complet
UserSchema.methods.getFullName = function() {
  return `${this.firstName} ${this.lastName}`;
};

module.exports = mongoose.model('User', UserSchema);