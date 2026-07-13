# 🌍 AirLight

**Plateforme de surveillance et de prédiction de la qualité de l'air au Sénégal**

AirLight collecte en continu les données de capteurs de qualité de l'air, les enrichit avec des données météo, et utilise le machine learning pour **prédire la qualité de l'air jusqu'à 7 jours (168 heures)**. La plateforme alerte les utilisateurs en cas de dégradation et envoie des rapports automatiques par email, avec pour objectif de sensibiliser les populations aux enjeux de pollution atmosphérique.

---

## ✨ Fonctionnalités

- 📡 **Collecte temps réel** des données de capteurs (PM2.5, PM10, CO₂, température, humidité) via l'intégration AirGradient
- 🤖 **Prédictions IA sur 7 jours** de la qualité de l'air (AQI), régénérées automatiquement
- 🌦️ **Enrichissement météo** des données et des prédictions
- 🔔 **Système d'alertes** en cas de dépassement des seuils de pollution
- 📧 **Rapports automatiques par email** (3 fois par semaine, via cron + API Brevo)
- 🔐 **Authentification Google OAuth** (Passport.js) et espace administrateur
- 🛡️ **Sécurité** : Helmet, rate limiting, sessions MongoDB

## 🏗️ Architecture

Le projet suit une architecture en microservices :

```
Capteurs AirGradient ──► Backend Node.js/Express ◄──► Service IA Flask
                              │                        (scikit-learn)
                          MongoDB                          │
                              │                     Prédictions 168h
                     Alertes · Rapports email · API REST
```

**Backend (Node.js / Express)**
- API REST : capteurs, prédictions, alertes, météo, admin, auth
- MongoDB (Mongoose) : `SensorData`, `Prediction`, `Alert`, `User`
- Tâches planifiées (cron) : régénération des prédictions, rapports tri-hebdomadaires
- Communication HTTP avec le service IA

**Service IA (Flask / Python)**
- Modèles **Random Forest** et **Gradient Boosting** (scikit-learn)
- Plus de 30 features : mesures brutes, variables temporelles (heure, jour, mois), lags et moyennes glissantes construites depuis un buffer historique
- Normalisation (StandardScaler) et validation temporelle (TimeSeriesSplit)
- Métriques : MAE, RMSE, R²
- Lissage entre prédictions consécutives pour éviter les oscillations

## 🛠️ Stack technique

| Couche | Technologies |
|---|---|
| Backend | Node.js, Express, Mongoose, Passport (Google OAuth) |
| IA / ML | Python, Flask, scikit-learn, pandas, NumPy |
| Base de données | MongoDB |
| Emails | API Brevo |
| Déploiement | Render (avec optimisations mémoire pour le free tier : traitement séquentiel, agrégations MongoDB, limite heap) |

## 🚀 Installation

### Prérequis
- Node.js ≥ 18, Python ≥ 3.10, MongoDB (local ou Atlas)

### 1. Backend

```bash
git clone https://github.com/maakhady/HackathonAIRLIGHT.git
cd HackathonAIRLIGHT
npm install
cp .env.example .env   # puis renseigner les variables
npm start
```

Variables d'environnement principales : `MONGODB_URI`, `SESSION_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `BREVO_API_KEY`, `AI_SERVICE_URL`.

### 2. Service IA

```bash
cd Service_IA
pip install -r requirements.txt
python app_optimized_7days.py
```

## 📡 Endpoints principaux

| Route | Description |
|---|---|
| `/sensors` | Données des capteurs (ingestion et consultation) |
| `/predictions` | Prédictions de qualité de l'air (jusqu'à 168h) |
| `/alerts` | Alertes de pollution |
| `/weather` | Données météo |
| `/auth` | Authentification Google OAuth |
| `/admin` | Administration |
| `/health` | État du service |

## 🧠 Ce que ce projet m'a appris

- Construire et itérer un **pipeline de ML complet** (features engineering, validation temporelle, lutte contre le surapprentissage) — le service IA en est à sa **v3**
- Faire communiquer des **microservices** (Node.js ↔ Flask) de façon résiliente (timeouts, keep-alive)
- Déployer et **optimiser sous contraintes réelles** : fuites mémoire corrigées, agrégations MongoDB à la place de requêtes massives, adaptation au free tier de Render

## 👩🏽‍💻 Auteur

**Mame Khady Laye DIAW** — Développeuse Full-Stack, Dakar
[GitHub](https://github.com/maakhady) · [LinkedIn](https://linkedin.com/in/mamekhady)

> Projet initié lors d'un hackathon, puis développé et déployé en autonomie.
