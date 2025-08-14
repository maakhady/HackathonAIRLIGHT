// config/passport.js - Configuration Passport pour Google OAuth
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const AuthService = require('../services/AuthService');
const User = require('../models/User'); // ✅ Import ajouté

const authService = new AuthService();

// Configuration de la stratégie Google
passport.use(new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL: process.env.GOOGLE_CALLBACK_URL
},
async (accessToken, refreshToken, profile, done) => {
  try {
    // Extraire les données du profil Google
    const googleData = {
      googleId: profile.id,
      email: profile.emails[0].value,
      firstName: profile.name.givenName,
      lastName: profile.name.familyName,
      avatar: profile.photos[0].value
    };

    // Utiliser le service d'authentification pour gérer l'utilisateur
    const result = await authService.googleAuth(googleData);
    
    if (result.success) {
      return done(null, result);
    } else {
      return done(new Error(result.message), null);
    }
    
  } catch (error) {
    console.error('❌ Erreur stratégie Google:', error.message);
    return done(error, null);
  }
}));

// Sérialisation pour les sessions (optionnel si vous utilisez JWT)
passport.serializeUser((user, done) => {
  done(null, user.user.id);
});

passport.deserializeUser(async (id, done) => {
  try {
    const user = await User.findById(id).select('-password');
    done(null, user);
  } catch (error) {
    done(error, null);
  }
});

module.exports = passport;