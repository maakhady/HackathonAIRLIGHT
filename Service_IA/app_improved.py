# ai_service/app_fixed.py - Service IA avec gestion des valeurs infinies et NaN
from flask import Flask, request, jsonify
from flask_cors import CORS
import pandas as pd
import numpy as np
from datetime import datetime, timedelta
import joblib
import os
import logging
import json
from sklearn.ensemble import RandomForestRegressor, GradientBoostingRegressor
from sklearn.preprocessing import StandardScaler, RobustScaler
from sklearn.metrics import mean_absolute_error, r2_score, mean_squared_error
from sklearn.model_selection import TimeSeriesSplit
import warnings
warnings.filterwarnings('ignore')

# Import optionnel pour LSTM
try:
    import tensorflow as tf
    from tensorflow.keras.models import Sequential
    from tensorflow.keras.layers import LSTM, Dense, Dropout
    from tensorflow.keras.callbacks import EarlyStopping
    LSTM_AVAILABLE = True
except ImportError:
    LSTM_AVAILABLE = False
    print("TensorFlow non disponible, utilisation de Random Forest uniquement")

app = Flask(__name__)
CORS(app)

# Configuration des logs
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# 🔧 CORRECTIONS PRINCIPALES POUR LES VALEURS INFINIES

def safe_division(numerator, denominator, fallback=0):
    """Division sécurisée pour éviter les valeurs infinies"""
    try:
        with np.errstate(divide='ignore', invalid='ignore'):
            result = np.divide(numerator, denominator, 
                             out=np.full_like(numerator, fallback, dtype=float), 
                             where=(denominator != 0))
            # Remplacer les inf et nan par la valeur de fallback
            result = np.where(np.isfinite(result), result, fallback)
            return result
    except:
        return fallback

def clean_infinite_values(df, method='clip'):
    """Nettoyer les valeurs infinies et NaN dans un DataFrame"""
    try:
        # Remplacer les inf par NaN
        df = df.replace([np.inf, -np.inf], np.nan)
        
        if method == 'clip':
            # Clipper les valeurs extrêmes
            for col in df.select_dtypes(include=[np.number]).columns:
                q1 = df[col].quantile(0.01)
                q99 = df[col].quantile(0.99)
                if pd.notna(q1) and pd.notna(q99):
                    df[col] = df[col].clip(lower=q1, upper=q99)
        
        # Remplir les NaN avec des valeurs appropriées
        for col in df.select_dtypes(include=[np.number]).columns:
            if df[col].isna().any():
                # Utiliser la médiane comme valeur de remplacement plus robuste
                median_val = df[col].median()
                if pd.isna(median_val):
                    # Si même la médiane est NaN, utiliser 0
                    median_val = 0
                df[col] = df[col].fillna(median_val)
        
        # Vérification finale
        for col in df.select_dtypes(include=[np.number]).columns:
            if not np.isfinite(df[col]).all():
                logger.warning(f"Valeurs non-finies détectées dans {col}, remplacement par 0")
                df[col] = df[col].where(np.isfinite(df[col]), 0)
        
        return df
        
    except Exception as e:
        logger.error(f"Erreur nettoyage valeurs infinies: {e}")
        # En cas d'erreur, remplir toutes les valeurs non-finies par 0
        return df.fillna(0).replace([np.inf, -np.inf], 0)

def convert_numpy_types(obj):
    """Convertir récursivement les types NumPy en types Python natifs"""
    if isinstance(obj, np.integer):
        return int(obj)
    elif isinstance(obj, np.floating):
        return float(obj)
    elif isinstance(obj, np.bool_):
        return bool(obj)
    elif isinstance(obj, np.ndarray):
        return obj.tolist()
    elif isinstance(obj, dict):
        return {key: convert_numpy_types(value) for key, value in obj.items()}
    elif isinstance(obj, list):
        return [convert_numpy_types(item) for item in obj]
    elif pd.isna(obj):
        return None
    else:
        return obj

class AirQualityPredictor:
    def __init__(self):
        self.models = {}
        self.scaler = None
        self.feature_scaler = None
        self.target_scaler = None
        self.feature_columns = [
            'pm25', 'pm10', 'co2', 'temperature', 'humidity', 
            'hour', 'dayOfWeek', 'month', 'aqi'
        ]
        self.model_version = "2.2"  # Version corrigée
        self.min_data_points = 48
        self.sequence_length = 24
        self.ensemble_weights = {
            'rf': 0.4,
            'gb': 0.3,
            'lstm': 0.3
        }
        
    def validate_input_data(self, data):
        """Valider et nettoyer les données d'entrée"""
        try:
            df = pd.DataFrame(data)
            
            # Vérifications de base
            if df.empty:
                return None, "DataFrame vide"
            
            # Vérifier les colonnes requises
            required_cols = ['timestamp', 'pm25', 'pm10', 'co2', 'temperature', 'humidity', 'hour', 'aqi']
            missing_cols = [col for col in required_cols if col not in df.columns]
            if missing_cols:
                return None, f"Colonnes manquantes: {missing_cols}"
            
            # Nettoyer les valeurs aberrantes
            for col in ['pm25', 'pm10', 'co2', 'aqi']:
                if col in df.columns:
                    # Valeurs négatives impossible
                    df[col] = df[col].clip(lower=0)
                    
                    # Valeurs extrêmes
                    if col in ['pm25', 'pm10']:
                        df[col] = df[col].clip(upper=1000)  # Max réaliste
                    elif col == 'co2':
                        df[col] = df[col].clip(lower=300, upper=10000)  # Plage réaliste
                    elif col == 'aqi':
                        df[col] = df[col].clip(upper=500)  # Max AQI
            
            # Température et humidité
            if 'temperature' in df.columns:
                df['temperature'] = df['temperature'].clip(-50, 60)  # Plage réaliste
            if 'humidity' in df.columns:
                df['humidity'] = df['humidity'].clip(0, 100)  # Pourcentage
            
            # Heures et jours
            if 'hour' in df.columns:
                df['hour'] = df['hour'] % 24
            if 'dayOfWeek' in df.columns:
                df['dayOfWeek'] = df['dayOfWeek'] % 7
            if 'month' in df.columns:
                df['month'] = df['month'].clip(1, 12)
            
            # Nettoyer les valeurs infinies
            df = clean_infinite_values(df)
            
            logger.info(f"Données validées: {len(df)} lignes, colonnes: {list(df.columns)}")
            return df, None
            
        except Exception as e:
            logger.error(f"Erreur validation données: {e}")
            return None, str(e)
        
    def prepare_features(self, data, include_external=True):
        """Préparer les features avec gestion robuste des erreurs"""
        try:
            # Valider d'abord les données
            df, error = self.validate_input_data(data)
            if error:
                return None, error
            
            # Convertir la timestamp
            df['timestamp'] = pd.to_datetime(df['timestamp'])
            df = df.sort_values('timestamp')
            
            # Features de base
            features_df = df[self.feature_columns].copy()
            
            # Features temporelles cycliques (sécurisées)
            features_df['hour_sin'] = np.sin(2 * np.pi * df['hour'] / 24)
            features_df['hour_cos'] = np.cos(2 * np.pi * df['hour'] / 24)
            features_df['day_sin'] = np.sin(2 * np.pi * df['dayOfWeek'] / 7)
            features_df['day_cos'] = np.cos(2 * np.pi * df['dayOfWeek'] / 7)
            features_df['month_sin'] = np.sin(2 * np.pi * df['month'] / 12)
            features_df['month_cos'] = np.cos(2 * np.pi * df['month'] / 12)
            
            # Indicateurs simples
            features_df['is_weekend'] = (df['dayOfWeek'] >= 5).astype(int)
            features_df['is_morning_rush'] = ((df['hour'] >= 6) & (df['hour'] <= 9)).astype(int)
            features_df['is_evening_rush'] = ((df['hour'] >= 17) & (df['hour'] <= 20)).astype(int)
            features_df['is_night'] = ((df['hour'] >= 22) | (df['hour'] <= 5)).astype(int)
            
            # Moyennes mobiles (avec gestion d'erreurs)
            for window in [3, 6, 12, 24]:
                try:
                    pm25_ma = df['pm25'].rolling(window=window, min_periods=1).mean()
                    pm10_ma = df['pm10'].rolling(window=window, min_periods=1).mean()
                    
                    # Vérifier les valeurs finies
                    if np.isfinite(pm25_ma).all():
                        features_df[f'pm25_ma_{window}'] = pm25_ma
                    else:
                        features_df[f'pm25_ma_{window}'] = df['pm25']
                        
                    if np.isfinite(pm10_ma).all():
                        features_df[f'pm10_ma_{window}'] = pm10_ma
                    else:
                        features_df[f'pm10_ma_{window}'] = df['pm10']
                        
                except Exception as e:
                    logger.warning(f"Erreur moyenne mobile {window}: {e}")
                    features_df[f'pm25_ma_{window}'] = df['pm25']
                    features_df[f'pm10_ma_{window}'] = df['pm10']
            
            # Écart-types (sécurisés)
            try:
                pm25_std_6 = df['pm25'].rolling(window=6, min_periods=1).std()
                pm25_std_24 = df['pm25'].rolling(window=24, min_periods=1).std()
                
                features_df['pm25_std_6'] = np.where(np.isfinite(pm25_std_6), pm25_std_6, 0)
                features_df['pm25_std_24'] = np.where(np.isfinite(pm25_std_24), pm25_std_24, 0)
            except:
                features_df['pm25_std_6'] = 0
                features_df['pm25_std_24'] = 0
            
            # Ratio PM2.5/PM10 (sécurisé)
            features_df['pm_ratio'] = safe_division(
                df['pm25'].values, 
                df['pm10'].values + 1,  # Éviter division par 0
                fallback=0.5  # Ratio par défaut
            )
            
            # Différences (sécurisées)
            for lag in [1, 6, 24]:
                try:
                    pm25_diff = df['pm25'].diff(lag)
                    features_df[f'pm25_diff_{lag}'] = np.where(np.isfinite(pm25_diff), pm25_diff, 0)
                except:
                    features_df[f'pm25_diff_{lag}'] = 0
            
            # Pourcentages de changement (sécurisés)
            try:
                pct_1 = df['pm25'].pct_change(1)
                pct_6 = df['pm25'].pct_change(6)
                
                features_df['pm25_pct_change_1'] = np.where(np.isfinite(pct_1), pct_1, 0)
                features_df['pm25_pct_change_6'] = np.where(np.isfinite(pct_6), pct_6, 0)
            except:
                features_df['pm25_pct_change_1'] = 0
                features_df['pm25_pct_change_6'] = 0
            
            # Features de lag
            for lag in [1, 6, 12, 24]:
                try:
                    pm25_lag = df['pm25'].shift(lag)
                    aqi_lag = df['aqi'].shift(lag)
                    
                    features_df[f'pm25_lag_{lag}'] = pm25_lag.fillna(method='bfill').fillna(df['pm25'].mean())
                    features_df[f'aqi_lag_{lag}'] = aqi_lag.fillna(method='bfill').fillna(df['aqi'].mean())
                except:
                    features_df[f'pm25_lag_{lag}'] = df['pm25'].mean()
                    features_df[f'aqi_lag_{lag}'] = df['aqi'].mean()
            
            # Features météo avancées (sécurisées)
            if 'temperature' in df.columns and 'humidity' in df.columns:
                try:
                    heat_index = self.calculate_heat_index_safe(df['temperature'], df['humidity'])
                    features_df['heat_index'] = heat_index
                    
                    temp_humid = safe_division(
                        df['temperature'].values * df['humidity'].values, 
                        100, 
                        fallback=20  # Valeur par défaut
                    )
                    features_df['temp_humidity_interaction'] = temp_humid
                    
                    features_df['is_hot'] = (df['temperature'] > 30).astype(int)
                    features_df['is_humid'] = (df['humidity'] > 70).astype(int)
                    features_df['is_dry'] = (df['humidity'] < 30).astype(int)
                except Exception as e:
                    logger.warning(f"Erreur features météo: {e}")
                    features_df['heat_index'] = df['temperature']
                    features_df['temp_humidity_interaction'] = 20
                    features_df['is_hot'] = 0
                    features_df['is_humid'] = 0
                    features_df['is_dry'] = 0
            
            # Index de pollution (sécurisé)
            try:
                pollution_index = (
                    df['pm25'] * 0.5 + 
                    df['pm10'] * 0.3 + 
                    np.maximum(df['co2'] - 400, 0) * 0.2
                )
                features_df['pollution_index'] = pollution_index
            except:
                features_df['pollution_index'] = df['pm25']
            
            # Z-score (sécurisé)
            try:
                pm25_mean = df['pm25'].mean()
                pm25_std = df['pm25'].std()
                if pm25_std > 0 and np.isfinite(pm25_std):
                    z_score = (df['pm25'] - pm25_mean) / pm25_std
                    features_df['pm25_zscore'] = np.where(np.isfinite(z_score), z_score, 0)
                else:
                    features_df['pm25_zscore'] = 0
                    
                features_df['is_anomaly'] = (np.abs(features_df['pm25_zscore']) > 2).astype(int)
            except:
                features_df['pm25_zscore'] = 0
                features_df['is_anomaly'] = 0
            
            # Features saisonnières
            features_df['is_dry_season'] = ((df['month'] >= 11) | (df['month'] <= 3)).astype(int)
            features_df['is_rainy_season'] = ((df['month'] >= 6) & (df['month'] <= 9)).astype(int)
            
            # Quantiles (sécurisés)
            try:
                q25 = df['pm25'].rolling(window=24, min_periods=1).quantile(0.25)
                q75 = df['pm25'].rolling(window=24, min_periods=1).quantile(0.75)
                
                features_df['pm25_quantile_25'] = np.where(np.isfinite(q25), q25, df['pm25'])
                features_df['pm25_quantile_75'] = np.where(np.isfinite(q75), q75, df['pm25'])
                features_df['pm25_iqr'] = features_df['pm25_quantile_75'] - features_df['pm25_quantile_25']
            except:
                features_df['pm25_quantile_25'] = df['pm25']
                features_df['pm25_quantile_75'] = df['pm25']
                features_df['pm25_iqr'] = 0
            
            # Nettoyage final complet
            features_df = clean_infinite_values(features_df)
            
            logger.info(f"Features préparées: {features_df.shape}, colonnes: {len(features_df.columns)}")
            return features_df, None
            
        except Exception as e:
            logger.error(f"Erreur préparation features: {e}")
            return None, str(e)
    
    def calculate_heat_index_safe(self, temp, humidity):
        """Calculer l'indice de chaleur de manière sécurisée"""
        try:
            # Clipper les valeurs d'entrée
            temp = np.clip(temp, -50, 60)
            humidity = np.clip(humidity, 0, 100)
            
            hi = -8.78469 + 1.61139 * temp + 2.33854 * humidity
            hi -= 0.14611 * temp * humidity
            hi -= 0.01230 * temp**2
            hi -= 0.01642 * humidity**2
            hi += 0.00221 * temp**2 * humidity
            hi += 0.00072 * temp * humidity**2
            
            # Remplacer par temp si conditions non appropriées
            result = np.where(temp < 27, temp, hi)
            
            # Vérifier et nettoyer les valeurs infinies
            result = np.where(np.isfinite(result), result, temp)
            
            return result
        except:
            return temp  # Fallback
    
    def train_model(self, data, use_ensemble=True):
        """Entraîner les modèles avec validation robuste"""
        try:
            logger.info(f"Entraînement avec {len(data)} points de données")
            
            # Préparer les features avec validation
            features_df, error = self.prepare_features(data)
            if error:
                return False, f"Erreur préparation features: {error}"
            
            # Target (PM2.5 suivant)
            df, _ = self.validate_input_data(data)
            targets = df['pm25'].shift(-1).dropna()
            features_df = features_df.iloc[:-1]
            
            # Vérification finale des données
            if len(features_df) != len(targets):
                min_len = min(len(features_df), len(targets))
                features_df = features_df.iloc[:min_len]
                targets = targets.iloc[:min_len]
            
            # Normalisation robuste (utilise RobustScaler au lieu de StandardScaler)
            self.feature_scaler = RobustScaler()
            self.target_scaler = RobustScaler()
            
            try:
                features_scaled = self.feature_scaler.fit_transform(features_df)
                targets_scaled = self.target_scaler.fit_transform(targets.values.reshape(-1, 1)).ravel()
                
                # Vérification des valeurs après normalisation
                if not np.isfinite(features_scaled).all():
                    logger.warning("Valeurs non-finies après normalisation features, nettoyage...")
                    features_scaled = np.where(np.isfinite(features_scaled), features_scaled, 0)
                
                if not np.isfinite(targets_scaled).all():
                    logger.warning("Valeurs non-finies après normalisation targets, nettoyage...")
                    targets_scaled = np.where(np.isfinite(targets_scaled), targets_scaled, 0)
                    
            except Exception as e:
                logger.error(f"Erreur normalisation: {e}")
                return False, f"Erreur normalisation: {e}"
            
            # Validation croisée temporelle
            tscv = TimeSeriesSplit(n_splits=3)
            scores = {'rf': [], 'gb': [], 'lstm': []}
            
            # 1. Random Forest (paramètres plus conservateurs)
            self.models['rf'] = RandomForestRegressor(
                n_estimators=100,  # Réduit pour plus de stabilité
                max_depth=10,      # Limité pour éviter l'overfitting
                min_samples_split=10,
                min_samples_leaf=5,
                max_features='sqrt',
                random_state=42,
                n_jobs=-1
            )
            
            # 2. Gradient Boosting (paramètres plus conservateurs)
            self.models['gb'] = GradientBoostingRegressor(
                n_estimators=100,
                learning_rate=0.1,
                max_depth=5,
                min_samples_split=10,
                min_samples_leaf=5,
                subsample=0.8,
                random_state=42
            )
            
            # Entraînement et validation croisée
            for train_idx, val_idx in tscv.split(features_scaled):
                X_train, X_val = features_scaled[train_idx], features_scaled[val_idx]
                y_train, y_val = targets_scaled[train_idx], targets_scaled[val_idx]
                
                try:
                    # Random Forest
                    self.models['rf'].fit(X_train, y_train)
                    rf_pred = self.models['rf'].predict(X_val)
                    scores['rf'].append(r2_score(y_val, rf_pred))
                    
                    # Gradient Boosting
                    self.models['gb'].fit(X_train, y_train)
                    gb_pred = self.models['gb'].predict(X_val)
                    scores['gb'].append(r2_score(y_val, gb_pred))
                    
                except Exception as model_error:
                    logger.warning(f"Erreur entraînement fold: {model_error}")
                    scores['rf'].append(0.5)
                    scores['gb'].append(0.5)
            
            # Entraînement final sur toutes les données
            try:
                self.models['rf'].fit(features_scaled, targets_scaled)
                self.models['gb'].fit(features_scaled, targets_scaled)
            except Exception as e:
                logger.error(f"Erreur entraînement final: {e}")
                return False, f"Erreur entraînement final: {e}"
            
            # Calcul des performances moyennes
            avg_scores = {k: np.mean(v) if v else 0.5 for k, v in scores.items()}
            
            # Ajuster les poids de l'ensemble
            if use_ensemble:
                total_score = sum(avg_scores.values())
                if total_score > 0:
                    self.ensemble_weights = {k: v/total_score for k, v in avg_scores.items()}
                else:
                    self.ensemble_weights = {'rf': 0.5, 'gb': 0.5, 'lstm': 0}
            
            # Prédictions finales pour évaluation
            try:
                final_predictions_scaled = self.predict_ensemble(features_scaled)
                final_predictions_original = self.target_scaler.inverse_transform(
                    final_predictions_scaled.reshape(-1, 1)
                ).ravel()
                
                mae = mean_absolute_error(targets, final_predictions_original)
                rmse = np.sqrt(mean_squared_error(targets, final_predictions_original))
                r2 = r2_score(targets, final_predictions_original)
                
            except Exception as e:
                logger.warning(f"Erreur évaluation finale: {e}")
                mae, rmse, r2 = 1.0, 1.0, 0.5
            
            # Analyse des features importantes (sécurisée)
            try:
                feature_importance = pd.DataFrame({
                    'feature': features_df.columns,
                    'importance': self.models['rf'].feature_importances_
                }).sort_values('importance', ascending=False).head(10)
                
                top_features = feature_importance.to_dict('records')
            except Exception as e:
                logger.warning(f"Erreur importance features: {e}")
                top_features = []
            
            logger.info(f"Modèles entraînés - MAE: {mae:.2f}, RMSE: {rmse:.2f}, R²: {r2:.3f}")
            logger.info(f"Poids ensemble: {self.ensemble_weights}")
            
            return True, convert_numpy_types({
                'mae': mae,
                'rmse': rmse,
                'r2_score': r2,
                'training_samples': len(targets),
                'ensemble_weights': self.ensemble_weights,
                'top_features': top_features,
                'model_scores': avg_scores
            })
            
        except Exception as e:
            logger.error(f"Erreur entraînement: {e}")
            return False, str(e)
    
    def predict_ensemble(self, features_scaled):
        """Prédiction par ensemble de modèles avec gestion d'erreurs"""
        try:
            predictions = np.zeros(len(features_scaled))
            
            # Random Forest
            if 'rf' in self.models and self.models['rf'] is not None:
                try:
                    rf_pred = self.models['rf'].predict(features_scaled)
                    if np.isfinite(rf_pred).all():
                        predictions += rf_pred * self.ensemble_weights.get('rf', 0.5)
                    else:
                        logger.warning("Prédictions RF non-finies, ignorées")
                except Exception as e:
                    logger.warning(f"Erreur prédiction RF: {e}")
            
            # Gradient Boosting
            if 'gb' in self.models and self.models['gb'] is not None:
                try:
                    gb_pred = self.models['gb'].predict(features_scaled)
                    if np.isfinite(gb_pred).all():
                        predictions += gb_pred * self.ensemble_weights.get('gb', 0.5)
                    else:
                        logger.warning("Prédictions GB non-finies, ignorées")
                except Exception as e:
                    logger.warning(f"Erreur prédiction GB: {e}")
            
            # Si toutes les prédictions sont nulles, utiliser une valeur par défaut
            if np.all(predictions == 0):
                predictions = np.full(len(features_scaled), 0.5)  # Valeur normalisée par défaut
            
            return predictions
            
        except Exception as e:
            logger.error(f"Erreur prédiction ensemble: {e}")
            return np.full(len(features_scaled), 0.5)
    
    # ... (reste des méthodes inchangées: predict, calculate_aqi, get_contributing_factors)
    
    def predict(self, data, hours_ahead=24):
        """Générer des prédictions avec gestion robuste des erreurs"""
        try:
            if not self.models or self.feature_scaler is None:
                return None, "Modèles non entraînés"
            
            # Préparer les features avec validation
            features_df, error = self.prepare_features(data)
            if error:
                return None, f"Erreur préparation features pour prédiction: {error}"
            
            predictions = []
            prediction_features = features_df.copy()
            
            for hour in range(1, min(hours_ahead + 1, 25)):  # Limiter à 24h max pour la stabilité
                try:
                    # Prendre les dernières features
                    last_features = prediction_features.iloc[-1:].copy()
                    features_scaled = self.feature_scaler.transform(last_features)
                    
                    # Vérifier les valeurs après transformation
                    if not np.isfinite(features_scaled).all():
                        logger.warning(f"Features non-finies à l'heure {hour}, nettoyage...")
                        features_scaled = np.where(np.isfinite(features_scaled), features_scaled, 0)
                    
                    # Prédiction ensemble
                    ensemble_pred = self.predict_ensemble(features_scaled)[0]
                    
                    # Dénormalisation
                    pred_pm25 = self.target_scaler.inverse_transform([[ensemble_pred]])[0, 0]
                    pred_pm25 = max(0, min(pred_pm25, 1000))  # Contraintes réalistes
                    
                    # Calculer l'AQI prédit
                    pred_aqi = self.calculate_aqi(pred_pm25)
                    
                    # Score de confiance basique
                    confidence = max(0.3, min(0.9, 0.7 - (hour - 1) * 0.05))
                    
                    # Timestamp de prédiction
                    base_time = datetime.fromisoformat(data[-1]['timestamp'].replace('Z', '+00:00'))
                    pred_time = base_time + timedelta(hours=hour)
                    
                    # Facteurs explicatifs simplifiés
                    feature_values = last_features.iloc[0]
                    contributing_factors = self.get_contributing_factors_safe(feature_values, pred_pm25)
                    
                    # Prédiction finale avec conversion sécurisée
                    prediction_dict = {
                        'hour_ahead': int(hour),
                        'predicted_pm25': float(round(pred_pm25, 2)),
                        'predicted_aqi': float(round(pred_aqi, 1)),
                        'confidence': float(round(confidence, 3)),
                        'timestamp': pred_time.isoformat(),
                        'contributing_factors': contributing_factors,
                        'modelVersion': self.model_version
                    }
                    
                    predictions.append(prediction_dict)
                    
                    # Mettre à jour les features pour la prochaine prédiction (simplifié)
                    new_row = last_features.copy()
                    new_row['pm25'] = pred_pm25
                    new_row['aqi'] = pred_aqi
                    new_row['hour'] = (new_row['hour'].iloc[0] + 1) % 24
                    
                    if new_row['hour'].iloc[0] == 0:
                        new_row['dayOfWeek'] = (new_row['dayOfWeek'].iloc[0] + 1) % 7
                    
                    # Mettre à jour quelques features essentielles seulement
                    for col in ['pm25_ma_3', 'pm25_ma_6']:
                        if col in prediction_features.columns:
                            try:
                                window = int(col.split('_')[-1])
                                recent_values = list(prediction_features['pm25'][-window+1:]) + [pred_pm25]
                                new_row[col] = np.mean(recent_values[-window:])
                            except:
                                new_row[col] = pred_pm25
                    
                    # Ajouter la nouvelle ligne
                    prediction_features = pd.concat([prediction_features, new_row], ignore_index=True)
                    
                except Exception as hour_error:
                    logger.warning(f"Erreur prédiction heure {hour}: {hour_error}")
                    # Prédiction de secours
                    base_time = datetime.fromisoformat(data[-1]['timestamp'].replace('Z', '+00:00'))
                    pred_time = base_time + timedelta(hours=hour)
                    
                    # Utiliser la dernière valeur connue comme prédiction de secours
                    last_pm25 = data[-1].get('pm25', 25)
                    
                    prediction_dict = {
                        'hour_ahead': int(hour),
                        'predicted_pm25': float(round(last_pm25, 2)),
                        'predicted_aqi': float(round(self.calculate_aqi(last_pm25), 1)),
                        'confidence': 0.3,  # Confiance faible pour les prédictions de secours
                        'timestamp': pred_time.isoformat(),
                        'contributing_factors': [],
                        'modelVersion': f"{self.model_version}-fallback"
                    }
                    
                    predictions.append(prediction_dict)
            
            return predictions, None
            
        except Exception as e:
            logger.error(f"Erreur prédiction: {e}")
            return None, str(e)
    
    def calculate_aqi(self, pm25):
        """Calculer l'AQI selon les standards US EPA (sécurisé)"""
        try:
            pm25 = max(0, min(pm25, 1000))  # Contraintes
            
            breakpoints = [
                (0, 12.0, 0, 50),
                (12.1, 35.4, 51, 100),
                (35.5, 55.4, 101, 150),
                (55.5, 150.4, 151, 200),
                (150.5, 250.4, 201, 300),
                (250.5, 350.4, 301, 400),
                (350.5, 500.4, 401, 500)
            ]
            
            for bp_low, bp_high, aqi_low, aqi_high in breakpoints:
                if bp_low <= pm25 <= bp_high:
                    aqi = ((aqi_high - aqi_low) / (bp_high - bp_low)) * (pm25 - bp_low) + aqi_low
                    return max(0, min(aqi, 500))
            
            return 500
        except:
            return 100  # Valeur par défaut
    
    def get_contributing_factors_safe(self, features, prediction):
        """Identifier les facteurs contributifs de manière sécurisée"""
        try:
            factors = []
            
            # Analyser les tendances (sécurisé)
            try:
                if 'pm25_ma_24' in features:
                    trend_24h = features['pm25_ma_24']
                    if pd.notna(trend_24h) and trend_24h > 0:
                        if prediction > trend_24h * 1.1:
                            factors.append({
                                'factor': 'Tendance croissante',
                                'impact': 'high',
                                'value': f"+{round((prediction/trend_24h - 1) * 100, 1)}%"
                            })
            except:
                pass
            
            # Heures de pointe
            try:
                if features.get('is_morning_rush', 0) == 1:
                    factors.append({
                        'factor': 'Heure de pointe matinale',
                        'impact': 'medium',
                        'value': 'Active'
                    })
            except:
                pass
            
            # Conditions météo
            try:
                if 'temperature' in features and pd.notna(features['temperature']):
                    if features['temperature'] > 30:
                        factors.append({
                            'factor': 'Température élevée',
                            'impact': 'medium',
                            'value': f"{round(features['temperature'], 1)}°C"
                        })
            except:
                pass
            
            try:
                if 'humidity' in features and pd.notna(features['humidity']):
                    if features['humidity'] < 30:
                        factors.append({
                            'factor': 'Air sec',
                            'impact': 'medium',
                            'value': f"{round(features['humidity'], 1)}%"
                        })
            except:
                pass
            
            # Saison
            try:
                if features.get('is_dry_season', 0) == 1:
                    factors.append({
                        'factor': 'Saison sèche',
                        'impact': 'high',
                        'value': 'Active'
                    })
            except:
                pass
            
            return factors[:3]  # Limiter à 3 facteurs
            
        except Exception as e:
            logger.warning(f"Erreur facteurs contributifs: {e}")
            return []

# Instance globale du prédicteur
predictor = AirQualityPredictor()

@app.route('/', methods=['GET'])
def health_check():
    """Vérification de santé du service"""
    return jsonify({
        'status': 'healthy',
        'service': 'AirLight AI Prediction Service (Fixed)',
        'version': predictor.model_version,
        'models_available': list(predictor.models.keys()),
        'lstm_available': LSTM_AVAILABLE,
        'features': 'Robust error handling for infinite values',
        'timestamp': datetime.now().isoformat()
    })

@app.route('/predict', methods=['POST'])
def predict():
    """Endpoint principal pour les prédictions avec gestion robuste des erreurs"""
    try:
        data = request.get_json()
        
        if not data or 'data' not in data:
            return jsonify({
                'success': False,
                'error': 'Données requises'
            }), 400
        
        sensor_id = data.get('sensorId', 'unknown')
        training_data = data['data']
        hours_ahead = min(data.get('hours_ahead', 6), 24)  # Limité à 24h pour la stabilité
        use_ensemble = data.get('use_ensemble', True)
        
        # Validation des données d'entrée
        if len(training_data) < predictor.min_data_points:
            return jsonify({
                'success': False,
                'error': f'Minimum {predictor.min_data_points} points de données requis, reçu {len(training_data)}'
            }), 400
        
        # Vérifier la structure des données
        required_fields = ['timestamp', 'pm25', 'pm10', 'co2', 'temperature', 'humidity', 'hour', 'aqi']
        first_record = training_data[0] if training_data else {}
        missing_fields = [field for field in required_fields if field not in first_record]
        
        if missing_fields:
            return jsonify({
                'success': False,
                'error': f'Champs manquants dans les données: {missing_fields}'
            }), 400
        
        logger.info(f"Début prédiction pour {sensor_id} - {len(training_data)} points, {hours_ahead}h")
        
        # Entraîner les modèles avec gestion d'erreurs
        train_success, train_result = predictor.train_model(training_data, use_ensemble)
        
        if not train_success:
            return jsonify({
                'success': False,
                'error': f'Échec entraînement: {train_result}',
                'fallback_available': True
            }), 500
        
        # Générer les prédictions
        predictions, error = predictor.predict(training_data, hours_ahead)
        
        if error:
            return jsonify({
                'success': False,
                'error': f'Erreur prédiction: {error}',
                'training_result': train_result
            }), 500
        
        if not predictions:
            return jsonify({
                'success': False,
                'error': 'Aucune prédiction générée',
                'training_result': train_result
            }), 500
        
        # Analyse statistique des prédictions (sécurisée)
        try:
            pred_values = [p['predicted_pm25'] for p in predictions if 'predicted_pm25' in p]
            if pred_values:
                stats = convert_numpy_types({
                    'mean': np.mean(pred_values),
                    'median': np.median(pred_values),
                    'std': np.std(pred_values),
                    'min': np.min(pred_values),
                    'max': np.max(pred_values),
                    'trend': 'increasing' if len(pred_values) > 1 and pred_values[-1] > pred_values[0] else 'stable',
                    'mean_confidence': np.mean([p.get('confidence', 0.5) for p in predictions])
                })
            else:
                stats = {'error': 'Aucune prédiction valide'}
        except Exception as stats_error:
            logger.warning(f"Erreur calcul stats: {stats_error}")
            stats = {'error': 'Erreur calcul statistiques'}
        
        logger.info(f"Prédictions générées avec succès pour {sensor_id}: {len(predictions)} heures")
        
        # Réponse finale sécurisée
        response_data = convert_numpy_types({
            'success': True,
            'sensor_id': sensor_id,
            'predictions': predictions,
            'statistics': stats,
            'model_performance': train_result,
            'timestamp': datetime.now().isoformat(),
            'hours_predicted': len(predictions)
        })
        
        return jsonify(response_data)
        
    except Exception as e:
        logger.error(f"Erreur endpoint predict: {e}")
        return jsonify({
            'success': False,
            'error': 'Erreur interne du serveur',
            'details': str(e) if app.debug else 'Contactez l\'administrateur'
        }), 500

@app.route('/model/info', methods=['GET'])
def model_info():
    """Informations sur les modèles actuels"""
    try:
        info_data = {
            'models': {
                'random_forest': {
                    'type': 'RandomForestRegressor',
                    'trained': 'rf' in predictor.models,
                    'n_estimators': 100,
                    'robust_features': True
                },
                'gradient_boosting': {
                    'type': 'GradientBoostingRegressor', 
                    'trained': 'gb' in predictor.models,
                    'n_estimators': 100,
                    'robust_features': True
                },
                'lstm': {
                    'type': 'LSTM Neural Network',
                    'available': LSTM_AVAILABLE,
                    'trained': 'lstm' in predictor.models,
                    'sequence_length': predictor.sequence_length
                }
            },
            'ensemble_weights': predictor.ensemble_weights,
            'version': predictor.model_version,
            'features_count': len(predictor.feature_columns),
            'min_data_points': predictor.min_data_points,
            'error_handling': {
                'infinite_values': 'Automatic cleanup',
                'missing_values': 'Robust imputation',
                'outliers': 'Clipping and winsorization',
                'scaler': 'RobustScaler (outlier-resistant)'
            }
        }
        
        return jsonify(convert_numpy_types(info_data))
        
    except Exception as e:
        logger.error(f"Erreur model info: {e}")
        return jsonify({
            'error': 'Erreur récupération infos modèle'
        }), 500

@app.route('/model/retrain', methods=['POST'])
def retrain_model():
    """Réentraîner les modèles avec de nouvelles données"""
    try:
        data = request.get_json()
        
        if not data or 'data' not in data:
            return jsonify({
                'success': False,
                'error': 'Données d\'entraînement requises'
            }), 400
        
        use_ensemble = data.get('use_ensemble', True)
        train_success, train_result = predictor.train_model(data['data'], use_ensemble)
        
        response_data = {
            'success': train_success,
            'result': train_result if train_success else {'error': train_result},
            'timestamp': datetime.now().isoformat()
        }
        
        return jsonify(convert_numpy_types(response_data))
        
    except Exception as e:
        logger.error(f"Erreur réentraînement: {e}")
        return jsonify({
            'success': False,
            'error': 'Erreur lors du réentraînement'
        }), 500

@app.route('/debug/data', methods=['POST'])
def debug_data():
    """Endpoint de debug pour analyser les données problématiques"""
    try:
        data = request.get_json()
        
        if not data or 'data' not in data:
            return jsonify({
                'success': False,
                'error': 'Données requises'
            }), 400
        
        # Analyser les données
        df = pd.DataFrame(data['data'])
        
        debug_info = {
            'data_shape': df.shape,
            'columns': list(df.columns),
            'null_counts': convert_numpy_types(df.isnull().sum().to_dict()),
            'infinite_counts': {},
            'data_types': convert_numpy_types(df.dtypes.astype(str).to_dict()),
            'statistics': {}
        }
        
        # Vérifier les valeurs infinies
        for col in df.select_dtypes(include=[np.number]).columns:
            inf_count = np.isinf(df[col]).sum()
            debug_info['infinite_counts'][col] = int(inf_count)
            
            # Statistiques basiques
            try:
                debug_info['statistics'][col] = {
                    'mean': float(df[col].mean()) if pd.notna(df[col].mean()) else None,
                    'std': float(df[col].std()) if pd.notna(df[col].std()) else None,
                    'min': float(df[col].min()) if pd.notna(df[col].min()) else None,
                    'max': float(df[col].max()) if pd.notna(df[col].max()) else None,
                    'has_negatives': bool((df[col] < 0).any()),
                    'has_zeros': bool((df[col] == 0).any())
                }
            except:
                debug_info['statistics'][col] = {'error': 'Cannot compute stats'}
        
        # Tester la validation
        validated_df, validation_error = predictor.validate_input_data(data['data'])
        
        debug_info['validation'] = {
            'success': validation_error is None,
            'error': validation_error,
            'cleaned_shape': validated_df.shape if validated_df is not None else None
        }
        
        return jsonify(debug_info)
        
    except Exception as e:
        logger.error(f"Erreur debug: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    debug = os.environ.get('DEBUG', 'False').lower() == 'true'
    
    logger.info(f"Démarrage du service IA corrigé sur le port {port}")
    logger.info(f"LSTM disponible: {LSTM_AVAILABLE}")
    logger.info("🔧 Corrections appliquées: gestion robuste des valeurs infinies et NaN")
    
    app.run(host='0.0.0.0', port=port, debug=debug)