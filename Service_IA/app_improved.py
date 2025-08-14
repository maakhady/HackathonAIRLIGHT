# ai_service/app_improved.py - Service IA amélioré avec modèles avancés
from flask import Flask, request, jsonify
from flask_cors import CORS
import pandas as pd
import numpy as np
from datetime import datetime, timedelta
import joblib
import os
import logging
from sklearn.ensemble import RandomForestRegressor, GradientBoostingRegressor
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import mean_absolute_error, r2_score, mean_squared_error
from sklearn.model_selection import TimeSeriesSplit
import warnings
warnings.filterwarnings('ignore')

# Import optionnel pour LSTM (si TensorFlow disponible)
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

class AirQualityPredictor:
    def __init__(self):
        self.models = {}  # Dictionnaire pour stocker plusieurs modèles
        self.scaler = None
        self.feature_scaler = None
        self.target_scaler = None
        self.feature_columns = [
            'pm25', 'pm10', 'co2', 'temperature', 'humidity', 
            'hour', 'dayOfWeek', 'month', 'aqi'
        ]
        self.model_version = "2.0"
        self.min_data_points = 48  # Augmenté pour plus de fiabilité
        self.sequence_length = 24  # Pour LSTM
        self.ensemble_weights = {
            'rf': 0.4,
            'gb': 0.3,
            'lstm': 0.3
        }
        
    def prepare_features(self, data, include_external=True):
        """Préparer les features avancées pour l'entraînement/prédiction"""
        try:
            df = pd.DataFrame(data)
            
            # Convertir la timestamp
            df['timestamp'] = pd.to_datetime(df['timestamp'])
            df = df.sort_values('timestamp')
            
            # Features de base
            features_df = df[self.feature_columns].copy()
            
            # Features temporelles cycliques
            features_df['hour_sin'] = np.sin(2 * np.pi * df['hour'] / 24)
            features_df['hour_cos'] = np.cos(2 * np.pi * df['hour'] / 24)
            features_df['day_sin'] = np.sin(2 * np.pi * df['dayOfWeek'] / 7)
            features_df['day_cos'] = np.cos(2 * np.pi * df['dayOfWeek'] / 7)
            features_df['month_sin'] = np.sin(2 * np.pi * df['month'] / 12)
            features_df['month_cos'] = np.cos(2 * np.pi * df['month'] / 12)
            
            # Indicateur jour ouvrable vs weekend
            features_df['is_weekend'] = (df['dayOfWeek'] >= 5).astype(int)
            
            # Périodes de la journée
            features_df['is_morning_rush'] = ((df['hour'] >= 6) & (df['hour'] <= 9)).astype(int)
            features_df['is_evening_rush'] = ((df['hour'] >= 17) & (df['hour'] <= 20)).astype(int)
            features_df['is_night'] = ((df['hour'] >= 22) | (df['hour'] <= 5)).astype(int)
            
            # Features de tendance (moyennes mobiles)
            for window in [3, 6, 12, 24]:
                features_df[f'pm25_ma_{window}'] = df['pm25'].rolling(window=window, min_periods=1).mean()
                features_df[f'pm10_ma_{window}'] = df['pm10'].rolling(window=window, min_periods=1).mean()
            
            # Features de variance et volatilité
            features_df['pm25_std_6'] = df['pm25'].rolling(window=6, min_periods=1).std().fillna(0)
            features_df['pm25_std_24'] = df['pm25'].rolling(window=24, min_periods=1).std().fillna(0)
            
            # Ratio PM2.5/PM10 (indicateur de la source de pollution)
            features_df['pm_ratio'] = (df['pm25'] / (df['pm10'] + 1)).fillna(0)
            
            # Features de différence et taux de changement
            features_df['pm25_diff_1'] = df['pm25'].diff(1).fillna(0)
            features_df['pm25_diff_6'] = df['pm25'].diff(6).fillna(0)
            features_df['pm25_diff_24'] = df['pm25'].diff(24).fillna(0)
            
            # Taux de changement en pourcentage
            features_df['pm25_pct_change_1'] = df['pm25'].pct_change(1).fillna(0)
            features_df['pm25_pct_change_6'] = df['pm25'].pct_change(6).fillna(0)
            
            # Features d'autocorrélation (lag features)
            for lag in [1, 6, 12, 24]:
                features_df[f'pm25_lag_{lag}'] = df['pm25'].shift(lag).fillna(method='bfill')
                features_df[f'aqi_lag_{lag}'] = df['aqi'].shift(lag).fillna(method='bfill')
            
            # Features météo avancées
            if 'temperature' in df.columns and 'humidity' in df.columns:
                # Indice de confort thermique
                features_df['heat_index'] = self.calculate_heat_index(
                    df['temperature'], 
                    df['humidity']
                )
                
                # Interaction température-humidité
                features_df['temp_humidity_interaction'] = df['temperature'] * df['humidity'] / 100
                
                # Catégories météo
                features_df['is_hot'] = (df['temperature'] > 30).astype(int)
                features_df['is_humid'] = (df['humidity'] > 70).astype(int)
                features_df['is_dry'] = (df['humidity'] < 30).astype(int)
            
            # Features de pollution croisées
            features_df['pollution_index'] = (
                df['pm25'] * 0.5 + 
                df['pm10'] * 0.3 + 
                (df['co2'] - 400) * 0.2
            )
            
            # Détection d'anomalies (Z-score)
            pm25_mean = df['pm25'].mean()
            pm25_std = df['pm25'].std()
            features_df['pm25_zscore'] = (df['pm25'] - pm25_mean) / (pm25_std + 1e-6)
            features_df['is_anomaly'] = (np.abs(features_df['pm25_zscore']) > 2).astype(int)
            
            # Features saisonnières avancées
            features_df['is_dry_season'] = ((df['month'] >= 11) | (df['month'] <= 3)).astype(int)
            features_df['is_rainy_season'] = ((df['month'] >= 6) & (df['month'] <= 9)).astype(int)
            
            # Quantiles et percentiles
            features_df['pm25_quantile_25'] = df['pm25'].rolling(window=24, min_periods=1).quantile(0.25)
            features_df['pm25_quantile_75'] = df['pm25'].rolling(window=24, min_periods=1).quantile(0.75)
            features_df['pm25_iqr'] = features_df['pm25_quantile_75'] - features_df['pm25_quantile_25']
            
            return features_df.fillna(method='ffill').fillna(0)
            
        except Exception as e:
            logger.error(f"Erreur préparation features: {e}")
            return None
    
    def calculate_heat_index(self, temp, humidity):
        """Calculer l'indice de chaleur"""
        # Formule simplifiée de l'indice de chaleur
        hi = -8.78469 + 1.61139 * temp + 2.33854 * humidity
        hi -= 0.14611 * temp * humidity
        hi -= 0.01230 * temp**2
        hi -= 0.01642 * humidity**2
        hi += 0.00221 * temp**2 * humidity
        hi += 0.00072 * temp * humidity**2
        hi -= 0.00000 * temp**2 * humidity**2
        return np.where(temp < 27, temp, hi)  # Appliquer seulement si temp > 27°C
    
    def prepare_lstm_sequences(self, features, targets):
        """Préparer les séquences pour LSTM"""
        X, y = [], []
        for i in range(self.sequence_length, len(features)):
            X.append(features[i-self.sequence_length:i])
            y.append(targets[i])
        return np.array(X), np.array(y)
    
    def build_lstm_model(self, input_shape):
        """Construire un modèle LSTM"""
        if not LSTM_AVAILABLE:
            return None
            
        model = Sequential([
            LSTM(128, return_sequences=True, input_shape=input_shape),
            Dropout(0.2),
            LSTM(64, return_sequences=True),
            Dropout(0.2),
            LSTM(32),
            Dropout(0.2),
            Dense(16, activation='relu'),
            Dense(1)
        ])
        
        model.compile(
            optimizer=tf.keras.optimizers.Adam(learning_rate=0.001),
            loss='mse',
            metrics=['mae']
        )
        
        return model
    
    def train_model(self, data, use_ensemble=True):
        """Entraîner les modèles avec validation croisée temporelle"""
        try:
            logger.info(f"Entraînement avec {len(data)} points de données")
            
            # Préparer les features
            features_df = self.prepare_features(data)
            if features_df is None:
                return False, "Erreur préparation des features"
            
            # Target (PM2.5 suivant)
            df = pd.DataFrame(data)
            targets = df['pm25'].shift(-1).dropna()
            features_df = features_df.iloc[:-1]
            
            # Normalisation
            self.feature_scaler = StandardScaler()
            self.target_scaler = StandardScaler()
            
            features_scaled = self.feature_scaler.fit_transform(features_df)
            targets_scaled = self.target_scaler.fit_transform(targets.values.reshape(-1, 1)).ravel()
            
            # Validation croisée temporelle
            tscv = TimeSeriesSplit(n_splits=3)
            scores = {'rf': [], 'gb': [], 'lstm': []}
            
            # 1. Random Forest
            self.models['rf'] = RandomForestRegressor(
                n_estimators=200,
                max_depth=15,
                min_samples_split=5,
                min_samples_leaf=2,
                random_state=42,
                n_jobs=-1
            )
            
            # 2. Gradient Boosting
            self.models['gb'] = GradientBoostingRegressor(
                n_estimators=150,
                learning_rate=0.05,
                max_depth=7,
                min_samples_split=5,
                min_samples_leaf=3,
                subsample=0.8,
                random_state=42
            )
            
            # Entraînement et validation croisée
            for train_idx, val_idx in tscv.split(features_scaled):
                X_train, X_val = features_scaled[train_idx], features_scaled[val_idx]
                y_train, y_val = targets_scaled[train_idx], targets_scaled[val_idx]
                
                # Random Forest
                self.models['rf'].fit(X_train, y_train)
                rf_pred = self.models['rf'].predict(X_val)
                scores['rf'].append(r2_score(y_val, rf_pred))
                
                # Gradient Boosting
                self.models['gb'].fit(X_train, y_train)
                gb_pred = self.models['gb'].predict(X_val)
                scores['gb'].append(r2_score(y_val, gb_pred))
            
            # 3. LSTM (si disponible)
            if LSTM_AVAILABLE and len(features_scaled) > self.sequence_length * 2:
                X_seq, y_seq = self.prepare_lstm_sequences(features_scaled, targets_scaled)
                
                if len(X_seq) > 0:
                    self.models['lstm'] = self.build_lstm_model((self.sequence_length, features_scaled.shape[1]))
                    
                    # Callbacks
                    early_stop = EarlyStopping(monitor='val_loss', patience=10, restore_best_weights=True)
                    
                    # Entraînement
                    history = self.models['lstm'].fit(
                        X_seq, y_seq,
                        epochs=50,
                        batch_size=32,
                        validation_split=0.2,
                        callbacks=[early_stop],
                        verbose=0
                    )
                    
                    # Score de validation
                    val_loss = min(history.history['val_loss'])
                    scores['lstm'] = [1 / (1 + val_loss)]  # Conversion en pseudo-R²
            
            # Entraînement final sur toutes les données
            self.models['rf'].fit(features_scaled, targets_scaled)
            self.models['gb'].fit(features_scaled, targets_scaled)
            
            # Calcul des performances moyennes
            avg_scores = {k: np.mean(v) if v else 0 for k, v in scores.items()}
            
            # Ajuster les poids de l'ensemble en fonction des performances
            if use_ensemble:
                total_score = sum(avg_scores.values())
                if total_score > 0:
                    self.ensemble_weights = {k: v/total_score for k, v in avg_scores.items()}
            
            # Prédictions finales pour évaluation
            final_predictions = self.predict_ensemble(features_scaled)
            final_predictions_original = self.target_scaler.inverse_transform(
                final_predictions.reshape(-1, 1)
            ).ravel()
            
            mae = mean_absolute_error(targets, final_predictions_original)
            rmse = np.sqrt(mean_squared_error(targets, final_predictions_original))
            r2 = r2_score(targets, final_predictions_original)
            
            # Analyse des features importantes (Random Forest)
            feature_importance = pd.DataFrame({
                'feature': features_df.columns,
                'importance': self.models['rf'].feature_importances_
            }).sort_values('importance', ascending=False).head(10)
            
            logger.info(f"Modèles entraînés - MAE: {mae:.2f}, RMSE: {rmse:.2f}, R²: {r2:.3f}")
            logger.info(f"Poids ensemble: {self.ensemble_weights}")
            logger.info(f"Top features: {feature_importance['feature'].tolist()[:5]}")
            
            return True, {
                'mae': mae,
                'rmse': rmse,
                'r2_score': r2,
                'training_samples': len(targets),
                'ensemble_weights': self.ensemble_weights,
                'top_features': feature_importance.to_dict('records'),
                'model_scores': avg_scores
            }
            
        except Exception as e:
            logger.error(f"Erreur entraînement: {e}")
            return False, str(e)
    
    def predict_ensemble(self, features_scaled):
        """Prédiction par ensemble de modèles"""
        predictions = np.zeros(len(features_scaled))
        
        # Random Forest
        if 'rf' in self.models and self.models['rf'] is not None:
            rf_pred = self.models['rf'].predict(features_scaled)
            predictions += rf_pred * self.ensemble_weights.get('rf', 0.33)
        
        # Gradient Boosting
        if 'gb' in self.models and self.models['gb'] is not None:
            gb_pred = self.models['gb'].predict(features_scaled)
            predictions += gb_pred * self.ensemble_weights.get('gb', 0.33)
        
        # LSTM
        if 'lstm' in self.models and self.models['lstm'] is not None and LSTM_AVAILABLE:
            # Pour LSTM, on a besoin de séquences
            if len(features_scaled) >= self.sequence_length:
                lstm_input = features_scaled[-self.sequence_length:].reshape(1, self.sequence_length, -1)
                lstm_pred = self.models['lstm'].predict(lstm_input, verbose=0)[0, 0]
                predictions[-1] = predictions[-1] * (1 - self.ensemble_weights.get('lstm', 0.34))
                predictions[-1] += lstm_pred * self.ensemble_weights.get('lstm', 0.34)
        
        return predictions
    
    def predict(self, data, hours_ahead=24):
        """Générer des prédictions avec intervalles de confiance"""
        try:
            if not self.models or self.feature_scaler is None:
                return None, "Modèles non entraînés"
            
            # Préparer les features
            features_df = self.prepare_features(data)
            if features_df is None:
                return None, "Erreur préparation features pour prédiction"
            
            predictions = []
            prediction_features = features_df.copy()
            
            for hour in range(1, hours_ahead + 1):
                # Prendre les dernières features
                last_features = prediction_features.iloc[-1:].copy()
                features_scaled = self.feature_scaler.transform(last_features)
                
                # Prédictions par modèle
                model_predictions = {}
                
                # Random Forest avec intervalles de confiance
                if 'rf' in self.models:
                    # Prédictions de tous les arbres
                    tree_predictions = []
                    for tree in self.models['rf'].estimators_:
                        tree_pred = tree.predict(features_scaled)[0]
                        tree_predictions.append(tree_pred)
                    
                    model_predictions['rf'] = {
                        'mean': np.mean(tree_predictions),
                        'std': np.std(tree_predictions),
                        'lower': np.percentile(tree_predictions, 5),
                        'upper': np.percentile(tree_predictions, 95)
                    }
                
                # Gradient Boosting
                if 'gb' in self.models:
                    gb_pred = self.models['gb'].predict(features_scaled)[0]
                    model_predictions['gb'] = {'mean': gb_pred}
                
                # Prédiction ensemble
                ensemble_pred = self.predict_ensemble(features_scaled)[0]
                
                # Dénormalisation
                pred_pm25 = self.target_scaler.inverse_transform([[ensemble_pred]])[0, 0]
                pred_pm25 = max(0, pred_pm25)
                
                # Intervalles de confiance (basés sur Random Forest)
                if 'rf' in model_predictions:
                    lower_bound = self.target_scaler.inverse_transform(
                        [[model_predictions['rf']['lower']]]
                    )[0, 0]
                    upper_bound = self.target_scaler.inverse_transform(
                        [[model_predictions['rf']['upper']]]
                    )[0, 0]
                    confidence_interval = [max(0, lower_bound), max(0, upper_bound)]
                    uncertainty = model_predictions['rf']['std']
                else:
                    confidence_interval = [pred_pm25 * 0.8, pred_pm25 * 1.2]
                    uncertainty = 0.1
                
                # Calculer l'AQI prédit
                pred_aqi = self.calculate_aqi(pred_pm25)
                
                # Score de confiance basé sur l'incertitude
                confidence = 1 / (1 + uncertainty)
                confidence = min(0.95, max(0.1, confidence))
                
                # Détection de conditions extrêmes
                is_extreme = pred_pm25 > np.percentile([d['pm25'] for d in data], 95)
                
                # Timestamp de prédiction
                base_time = datetime.fromisoformat(data[-1]['timestamp'].replace('Z', '+00:00'))
                pred_time = base_time + timedelta(hours=hour)
                
                # Facteurs explicatifs
                feature_values = last_features.iloc[0]
                contributing_factors = self.get_contributing_factors(feature_values, pred_pm25)
                
                predictions.append({
                    'hour_ahead': hour,
                    'predicted_pm25': round(pred_pm25, 2),
                    'confidence_interval': [round(ci, 2) for ci in confidence_interval],
                    'predicted_aqi': round(pred_aqi, 1),
                    'confidence': round(confidence, 3),
                    'uncertainty': round(uncertainty, 3),
                    'timestamp': pred_time.isoformat(),
                    'is_extreme': is_extreme,
                    'contributing_factors': contributing_factors,
                    'model_contributions': {
                        k: round(v.get('mean', 0), 2) 
                        for k, v in model_predictions.items()
                    },
                    'modelVersion': self.model_version
                })
                
                # Mettre à jour les features pour la prochaine prédiction
                # Simuler l'évolution des features
                new_row = last_features.copy()
                new_row['pm25'] = pred_pm25
                new_row['aqi'] = pred_aqi
                new_row['hour'] = (new_row['hour'].iloc[0] + 1) % 24
                
                # Mettre à jour les features temporelles
                if new_row['hour'].iloc[0] == 0:
                    new_row['dayOfWeek'] = (new_row['dayOfWeek'].iloc[0] + 1) % 7
                
                # Recalculer les features dérivées
                for col in prediction_features.columns:
                    if 'ma_' in col:
                        window = int(col.split('_')[-1])
                        recent_values = list(prediction_features[col.split('_ma_')[0]][-window+1:]) + [pred_pm25]
                        new_row[col] = np.mean(recent_values[-window:])
                
                prediction_features = pd.concat([prediction_features, new_row], ignore_index=True)
            
            return predictions, None
            
        except Exception as e:
            logger.error(f"Erreur prédiction: {e}")
            return None, str(e)
    
    def calculate_aqi(self, pm25):
        """Calculer l'AQI selon les standards US EPA"""
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
                return aqi
        
        return 500  # Max AQI
    
    def get_contributing_factors(self, features, prediction):
        """Identifier les facteurs contributifs principaux"""
        factors = []
        
        # Analyser les tendances
        if 'pm25_ma_24' in features:
            trend_24h = features['pm25_ma_24']
            if prediction > trend_24h * 1.1:
                factors.append({
                    'factor': 'Tendance croissante',
                    'impact': 'high',
                    'value': f"+{round((prediction/trend_24h - 1) * 100, 1)}%"
                })
        
        # Heures de pointe
        if features.get('is_morning_rush', 0) == 1:
            factors.append({
                'factor': 'Heure de pointe matinale',
                'impact': 'medium',
                'value': 'Active'
            })
        
        # Conditions météo
        if 'temperature' in features and features['temperature'] > 30:
            factors.append({
                'factor': 'Température élevée',
                'impact': 'medium',
                'value': f"{round(features['temperature'], 1)}°C"
            })
        
        if 'humidity' in features and features['humidity'] < 30:
            factors.append({
                'factor': 'Air sec',
                'impact': 'medium',
                'value': f"{round(features['humidity'], 1)}%"
            })
        
        # Saison
        if features.get('is_dry_season', 0) == 1:
            factors.append({
                'factor': 'Saison sèche',
                'impact': 'high',
                'value': 'Active'
            })
        
        return factors[:3]  # Top 3 facteurs

# Instance globale du prédicteur
predictor = AirQualityPredictor()

@app.route('/', methods=['GET'])
def health_check():
    """Vérification de santé du service"""
    return jsonify({
        'status': 'healthy',
        'service': 'AirLight AI Prediction Service',
        'version': predictor.model_version,
        'models_available': list(predictor.models.keys()),
        'lstm_available': LSTM_AVAILABLE,
        'timestamp': datetime.now().isoformat()
    })

@app.route('/predict', methods=['POST'])
def predict():
    """Endpoint principal pour les prédictions"""
    try:
        data = request.get_json()
        
        if not data or 'data' not in data:
            return jsonify({
                'success': False,
                'error': 'Données requises'
            }), 400
        
        sensor_id = data.get('sensorId', 'unknown')
        training_data = data['data']
        hours_ahead = min(data.get('hours_ahead', 24), 72)  # Max 72h
        use_ensemble = data.get('use_ensemble', True)
        
        if len(training_data) < predictor.min_data_points:
            return jsonify({
                'success': False,
                'error': f'Minimum {predictor.min_data_points} points de données requis'
            }), 400
        
        # Entraîner les modèles
        train_success, train_result = predictor.train_model(training_data, use_ensemble)
        
        if not train_success:
            return jsonify({
                'success': False,
                'error': f'Échec entraînement: {train_result}'
            }), 500
        
        # Générer les prédictions
        predictions, error = predictor.predict(training_data, hours_ahead)
        
        if error:
            return jsonify({
                'success': False,
                'error': error
            }), 500
        
        # Analyse statistique des prédictions
        pred_values = [p['predicted_pm25'] for p in predictions]
        stats = {
            'mean': round(np.mean(pred_values), 2),
            'median': round(np.median(pred_values), 2),
            'std': round(np.std(pred_values), 2),
            'min': round(np.min(pred_values), 2),
            'max': round(np.max(pred_values), 2),
            'trend': 'increasing' if pred_values[-1] > pred_values[0] else 'decreasing'
        }
        
        logger.info(f"Prédictions générées pour {sensor_id}: {len(predictions)} heures")
        
        return jsonify({
            'success': True,
            'sensor_id': sensor_id,
            'predictions': predictions,
            'statistics': stats,
            'model_performance': train_result,
            'timestamp': datetime.now().isoformat()
        })
        
    except Exception as e:
        logger.error(f"Erreur endpoint predict: {e}")
        return jsonify({
            'success': False,
            'error': 'Erreur interne du serveur'
        }), 500

@app.route('/model/info', methods=['GET'])
def model_info():
    """Informations sur les modèles actuels"""
    return jsonify({
        'models': {
            'random_forest': {
                'type': 'RandomForestRegressor',
                'trained': 'rf' in predictor.models,
                'n_estimators': 200
            },
            'gradient_boosting': {
                'type': 'GradientBoostingRegressor',
                'trained': 'gb' in predictor.models,
                'n_estimators': 150
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
        'min_data_points': predictor.min_data_points
    })

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
        
        return jsonify({
            'success': train_success,
            'result': train_result if train_success else {'error': train_result}
        })
        
    except Exception as e:
        logger.error(f"Erreur réentraînement: {e}")
        return jsonify({
            'success': False,
            'error': 'Erreur lors du réentraînement'
        }), 500

@app.route('/analyze/anomalies', methods=['POST'])
def detect_anomalies():
    """Détecter les anomalies dans les données"""
    try:
        data = request.get_json()
        
        if not data or 'data' not in data:
            return jsonify({
                'success': False,
                'error': 'Données requises'
            }), 400
        
        df = pd.DataFrame(data['data'])
        df['timestamp'] = pd.to_datetime(df['timestamp'])
        
        # Détection d'anomalies avec Isolation Forest
        from sklearn.ensemble import IsolationForest
        
        # Features pour la détection d'anomalies
        anomaly_features = ['pm25', 'pm10', 'co2', 'aqi']
        X = df[anomaly_features].fillna(0)
        
        # Modèle de détection
        iso_forest = IsolationForest(
            contamination=0.1,  # 10% d'anomalies attendues
            random_state=42
        )
        
        # Prédictions (-1 pour anomalie, 1 pour normal)
        anomalies = iso_forest.fit_predict(X)
        
        # Score d'anomalie (plus c'est négatif, plus c'est anormal)
        anomaly_scores = iso_forest.score_samples(X)
        
        # Identifier les anomalies
        anomaly_indices = np.where(anomalies == -1)[0]
        
        # Analyser les anomalies
        anomaly_data = []
        for idx in anomaly_indices:
            row = df.iloc[idx]
            
            # Déterminer le type d'anomalie
            anomaly_type = []
            if row['pm25'] > df['pm25'].quantile(0.95):
                anomaly_type.append('PM2.5 élevé')
            if row['pm10'] > df['pm10'].quantile(0.95):
                anomaly_type.append('PM10 élevé')
            if row['co2'] > df['co2'].quantile(0.95):
                anomaly_type.append('CO2 élevé')
            
            anomaly_data.append({
                'timestamp': row['timestamp'].isoformat(),
                'pm25': row['pm25'],
                'pm10': row['pm10'],
                'co2': row['co2'],
                'aqi': row['aqi'],
                'anomaly_score': round(float(anomaly_scores[idx]), 3),
                'anomaly_types': anomaly_type,
                'severity': 'high' if anomaly_scores[idx] < -0.5 else 'medium'
            })
        
        # Statistiques
        stats = {
            'total_records': len(df),
            'anomalies_detected': len(anomaly_indices),
            'anomaly_rate': round(len(anomaly_indices) / len(df) * 100, 2),
            'avg_anomaly_score': round(float(np.mean(anomaly_scores[anomaly_indices])), 3) if len(anomaly_indices) > 0 else 0
        }
        
        return jsonify({
            'success': True,
            'anomalies': anomaly_data,
            'statistics': stats,
            'timestamp': datetime.now().isoformat()
        })
        
    except Exception as e:
        logger.error(f"Erreur détection anomalies: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/analyze/patterns', methods=['POST'])
def analyze_patterns():
    """Analyser les patterns dans les données"""
    try:
        data = request.get_json()
        
        if not data or 'data' not in data:
            return jsonify({
                'success': False,
                'error': 'Données requises'
            }), 400
        
        df = pd.DataFrame(data['data'])
        df['timestamp'] = pd.to_datetime(df['timestamp'])
        df = df.sort_values('timestamp')
        
        # Patterns journaliers
        hourly_patterns = df.groupby('hour')['pm25'].agg(['mean', 'std', 'min', 'max'])
        daily_pattern = {
            'peak_hours': hourly_patterns['mean'].nlargest(3).index.tolist(),
            'low_hours': hourly_patterns['mean'].nsmallest(3).index.tolist(),
            'most_variable_hours': hourly_patterns['std'].nlargest(3).index.tolist()
        }
        
        # Patterns hebdomadaires
        weekly_patterns = df.groupby('dayOfWeek')['pm25'].agg(['mean', 'std'])
        weekly_pattern = {
            'worst_days': weekly_patterns['mean'].nlargest(2).index.tolist(),
            'best_days': weekly_patterns['mean'].nsmallest(2).index.tolist(),
            'weekend_vs_weekday': {
                'weekend_avg': df[df['dayOfWeek'].isin([5, 6])]['pm25'].mean(),
                'weekday_avg': df[~df['dayOfWeek'].isin([5, 6])]['pm25'].mean()
            }
        }
        
        # Corrélations
        correlations = {
            'pm25_temperature': df['pm25'].corr(df['temperature']),
            'pm25_humidity': df['pm25'].corr(df['humidity']),
            'pm25_co2': df['pm25'].corr(df['co2']),
            'pm10_pm25': df['pm10'].corr(df['pm25'])
        }
        
        # Tendances
        from scipy import stats
        x = np.arange(len(df))
        slope, intercept, r_value, p_value, std_err = stats.linregress(x, df['pm25'])
        
        trend_analysis = {
            'trend_direction': 'increasing' if slope > 0 else 'decreasing',
            'trend_strength': abs(r_value),
            'significant': p_value < 0.05,
            'daily_change_rate': slope * 24  # Changement par jour
        }
        
        # Cycles et saisonnalité (analyse FFT simplifiée)
        from scipy.fft import fft, fftfreq
        
        # Enlever la tendance
        detrended = df['pm25'] - (slope * x + intercept)
        
        # FFT
        N = len(detrended)
        yf = fft(detrended.values)
        xf = fftfreq(N, 1)[:N//2]
        
        # Trouver les fréquences dominantes
        power = 2.0/N * np.abs(yf[:N//2])
        dominant_freq_idx = np.argsort(power)[-5:]  # Top 5 fréquences
        
        cycles = []
        for idx in dominant_freq_idx:
            if xf[idx] > 0:  # Éviter division par zéro
                period = 1/xf[idx]
                if period < len(df):  # Périodes raisonnables
                    cycles.append({
                        'period_hours': round(period, 1),
                        'strength': round(float(power[idx]), 3)
                    })
        
        return jsonify({
            'success': True,
            'patterns': {
                'daily': daily_pattern,
                'weekly': weekly_pattern,
                'correlations': {k: round(v, 3) if not pd.isna(v) else None for k, v in correlations.items()},
                'trend': trend_analysis,
                'cycles': sorted(cycles, key=lambda x: x['strength'], reverse=True)[:3]
            },
            'recommendations': generate_recommendations(daily_pattern, weekly_pattern, correlations),
            'timestamp': datetime.now().isoformat()
        })
        
    except Exception as e:
        logger.error(f"Erreur analyse patterns: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

def generate_recommendations(daily, weekly, correlations):
    """Générer des recommandations basées sur les patterns"""
    recommendations = []
    
    # Recommandations basées sur les heures de pointe
    if daily['peak_hours']:
        peak_hours_str = ', '.join([f"{h}h" for h in daily['peak_hours']])
        recommendations.append({
            'type': 'timing',
            'priority': 'high',
            'message': f"Évitez les activités extérieures durant les heures de pointe: {peak_hours_str}",
            'action': 'Planifiez vos sorties en dehors de ces heures'
        })
    
    # Recommandations basées sur les jours
    if weekly['weekend_vs_weekday']['weekend_avg'] < weekly['weekend_vs_weekday']['weekday_avg'] * 0.8:
        recommendations.append({
            'type': 'weekly_pattern',
            'priority': 'medium',
            'message': "La qualité de l'air est généralement meilleure le weekend",
            'action': 'Privilégiez les activités extérieures le weekend'
        })
    
    # Recommandations basées sur les corrélations
    if correlations.get('pm25_temperature') and correlations['pm25_temperature'] > 0.5:
        recommendations.append({
            'type': 'weather',
            'priority': 'medium',
            'message': "La pollution augmente avec la température",
            'action': 'Soyez particulièrement vigilant lors des journées chaudes'
        })
    
    if correlations.get('pm25_humidity') and correlations['pm25_humidity'] < -0.3:
        recommendations.append({
            'type': 'weather',
            'priority': 'low',
            'message': "L'humidité aide à réduire les particules dans l'air",
            'action': 'Les jours humides peuvent offrir un air légèrement meilleur'
        })
    
    return recommendations

@app.route('/export/report', methods=['POST'])
def export_report():
    """Générer un rapport complet d'analyse"""
    try:
        data = request.get_json()
        
        if not data or 'data' not in data:
            return jsonify({
                'success': False,
                'error': 'Données requises'
            }), 400
        
        sensor_id = data.get('sensorId', 'unknown')
        df = pd.DataFrame(data['data'])
        df['timestamp'] = pd.to_datetime(df['timestamp'])
        
        # Statistiques générales
        stats = {
            'period': {
                'start': df['timestamp'].min().isoformat(),
                'end': df['timestamp'].max().isoformat(),
                'duration_days': (df['timestamp'].max() - df['timestamp'].min()).days
            },
            'pm25': {
                'mean': round(df['pm25'].mean(), 2),
                'median': round(df['pm25'].median(), 2),
                'std': round(df['pm25'].std(), 2),
                'min': round(df['pm25'].min(), 2),
                'max': round(df['pm25'].max(), 2),
                'p25': round(df['pm25'].quantile(0.25), 2),
                'p75': round(df['pm25'].quantile(0.75), 2),
                'p95': round(df['pm25'].quantile(0.95), 2)
            },
            'aqi': {
                'mean': round(df['aqi'].mean(), 1),
                'good_days': len(df[df['aqi'] <= 50]),
                'moderate_days': len(df[(df['aqi'] > 50) & (df['aqi'] <= 100)]),
                'unhealthy_days': len(df[df['aqi'] > 100])
            },
            'data_quality': {
                'total_records': len(df),
                'missing_values': df.isnull().sum().to_dict(),
                'completeness': round((1 - df.isnull().sum().sum() / (len(df) * len(df.columns))) * 100, 2)
            }
        }
        
        # Tendances mensuelles
        monthly_trends = df.groupby(df['timestamp'].dt.to_period('M')).agg({
            'pm25': ['mean', 'std', 'min', 'max'],
            'aqi': 'mean'
        }).round(2)
        
        # Générer le rapport
        report = {
            'sensor_id': sensor_id,
            'generated_at': datetime.now().isoformat(),
            'statistics': stats,
            'monthly_trends': monthly_trends.to_dict() if not monthly_trends.empty else {},
            'data_summary': {
                'total_measurements': len(df),
                'period_covered': f"{stats['period']['duration_days']} jours",
                'avg_air_quality': 'Good' if stats['aqi']['mean'] <= 50 else 'Moderate' if stats['aqi']['mean'] <= 100 else 'Unhealthy'
            }
        }
        
        return jsonify({
            'success': True,
            'report': report
        })
        
    except Exception as e:
        logger.error(f"Erreur génération rapport: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    debug = os.environ.get('DEBUG', 'False').lower() == 'true'
    
    logger.info(f"Démarrage du service IA amélioré sur le port {port}")
    logger.info(f"LSTM disponible: {LSTM_AVAILABLE}")
    app.run(host='0.0.0.0', port=port, debug=debug)