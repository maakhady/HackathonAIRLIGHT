# ai_service/app.py - Service IA Flask pour les prédictions
from flask import Flask, request, jsonify
from flask_cors import CORS
import pandas as pd
import numpy as np
from datetime import datetime, timedelta
import joblib
import os
import logging
from sklearn.ensemble import RandomForestRegressor
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import mean_absolute_error, r2_score
import warnings
warnings.filterwarnings('ignore')

app = Flask(__name__)
CORS(app)

# Configuration des logs
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class AirQualityPredictor:
    def __init__(self):
        self.model = None
        self.scaler = None
        self.feature_columns = [
            'pm25', 'pm10', 'co2', 'temperature', 'humidity', 
            'hour', 'dayOfWeek', 'month', 'aqi'
        ]
        self.model_version = "1.0"
        self.min_data_points = 24
        
    def prepare_features(self, data):
        """Préparer les features pour l'entraînement/prédiction"""
        try:
            df = pd.DataFrame(data)
            
            # Convertir la timestamp
            df['timestamp'] = pd.to_datetime(df['timestamp'])
            df = df.sort_values('timestamp')
            
            # Features de base
            features_df = df[self.feature_columns].copy()
            
            # Features temporelles supplémentaires
            features_df['hour_sin'] = np.sin(2 * np.pi * df['hour'] / 24)
            features_df['hour_cos'] = np.cos(2 * np.pi * df['hour'] / 24)
            features_df['day_sin'] = np.sin(2 * np.pi * df['dayOfWeek'] / 7)
            features_df['day_cos'] = np.cos(2 * np.pi * df['dayOfWeek'] / 7)
            features_df['month_sin'] = np.sin(2 * np.pi * df['month'] / 12)
            features_df['month_cos'] = np.cos(2 * np.pi * df['month'] / 12)
            
            # Features de tendance (moyennes mobiles)
            features_df['pm25_ma_3'] = df['pm25'].rolling(window=3, min_periods=1).mean()
            features_df['pm25_ma_6'] = df['pm25'].rolling(window=6, min_periods=1).mean()
            features_df['aqi_ma_3'] = df['aqi'].rolling(window=3, min_periods=1).mean()
            
            # Features de variance
            features_df['pm25_std_3'] = df['pm25'].rolling(window=3, min_periods=1).std().fillna(0)
            
            # Features de différence (changement par rapport au point précédent)
            features_df['pm25_diff'] = df['pm25'].diff().fillna(0)
            features_df['aqi_diff'] = df['aqi'].diff().fillna(0)
            
            return features_df.fillna(method='ffill').fillna(0)
            
        except Exception as e:
            logger.error(f"Erreur préparation features: {e}")
            return None
    
    def train_model(self, data):
        """Entraîner le modèle avec les données historiques"""
        try:
            logger.info(f"Entraînement avec {len(data)} points de données")
            
            # Préparer les features
            features_df = self.prepare_features(data)
            if features_df is None:
                return False, "Erreur préparation des features"
            
            # Target (PM2.5 suivant)
            df = pd.DataFrame(data)
            targets = df['pm25'].shift(-1).dropna()  # Prédire la valeur suivante
            features_df = features_df.iloc[:-1]  # Retirer la dernière ligne
            
            if len(features_df) != len(targets):
                return False, "Taille features/targets incohérente"
            
            # Normalisation
            self.scaler = StandardScaler()
            features_scaled = self.scaler.fit_transform(features_df)
            
            # Entraînement du modèle
            self.model = RandomForestRegressor(
                n_estimators=100,
                max_depth=10,
                random_state=42,
                n_jobs=-1
            )
            
            self.model.fit(features_scaled, targets)
            
            # Évaluation
            predictions = self.model.predict(features_scaled)
            mae = mean_absolute_error(targets, predictions)
            r2 = r2_score(targets, predictions)
            
            logger.info(f"Modèle entraîné - MAE: {mae:.2f}, R²: {r2:.3f}")
            
            return True, {
                'mae': mae,
                'r2_score': r2,
                'training_samples': len(targets)
            }
            
        except Exception as e:
            logger.error(f"Erreur entraînement: {e}")
            return False, str(e)
    
    def predict(self, data, hours_ahead=1):
        """Générer des prédictions"""
        try:
            if self.model is None or self.scaler is None:
                return None, "Modèle non entraîné"
            
            # Préparer les features
            features_df = self.prepare_features(data)
            if features_df is None:
                return None, "Erreur préparation features pour prédiction"
            
            predictions = []
            last_data = features_df.iloc[-1:].copy()
            
            for hour in range(1, hours_ahead + 1):
                # Normaliser les features
                features_scaled = self.scaler.transform(last_data)
                
                # Prédiction
                pred_pm25 = self.model.predict(features_scaled)[0]
                pred_pm25 = max(0, pred_pm25)  # Assurer une valeur positive
                
                # Calculer l'AQI prédit (formule simplifiée)
                if pred_pm25 <= 10:
                    pred_aqi = pred_pm25 * 2.5
                elif pred_pm25 <= 35:
                    pred_aqi = 25 + (pred_pm25 - 10) * 2
                else:
                    pred_aqi = min(500, 75 + (pred_pm25 - 35) * 1.5)
                
                # Calculer la confiance (basée sur la variance des prédictions)
                # Prédictions multiples avec différents sous-ensembles
                confidences = []
                for estimator in self.model.estimators_[:10]:  # 10 premiers arbres
                    conf_pred = estimator.predict(features_scaled)[0]
                    confidences.append(conf_pred)
                
                confidence = 1 / (1 + np.std(confidences))  # Plus la variance est faible, plus la confiance est élevée
                confidence = min(0.95, max(0.1, confidence))  # Borner entre 0.1 et 0.95
                
                # Timestamp de prédiction
                base_time = datetime.fromisoformat(data[-1]['timestamp'].replace('Z', '+00:00'))
                pred_time = base_time + timedelta(hours=hour)
                
                predictions.append({
                    'hour_ahead': hour,
                    'predicted_pm25': round(pred_pm25, 2),
                    'predicted_aqi': round(pred_aqi, 1),
                    'confidence': round(confidence, 3),
                    'timestamp': pred_time.isoformat(),
                    'factors': {
                        'historical_avg': round(np.mean([d['pm25'] for d in data[-6:]]), 2),
                        'trend': 'increasing' if pred_pm25 > data[-1]['pm25'] else 'decreasing'
                    },
                    'modelVersion': self.model_version
                })
                
                # Mettre à jour les features pour la prédiction suivante
                # (simulation simple - dans un cas réel, on utiliserait des prévisions météo)
                new_row = last_data.copy()
                new_row['pm25'] = pred_pm25
                new_row['aqi'] = pred_aqi
                new_row['hour'] = (new_row['hour'].iloc[0] + 1) % 24
                
                # Mettre à jour les moyennes mobiles
                new_row['pm25_ma_3'] = (last_data['pm25_ma_3'].iloc[0] * 2 + pred_pm25) / 3
                new_row['pm25_ma_6'] = (last_data['pm25_ma_6'].iloc[0] * 5 + pred_pm25) / 6
                new_row['aqi_ma_3'] = (last_data['aqi_ma_3'].iloc[0] * 2 + pred_aqi) / 3
                
                last_data = new_row
            
            return predictions, None
            
        except Exception as e:
            logger.error(f"Erreur prédiction: {e}")
            return None, str(e)

# Instance globale du prédicteur
predictor = AirQualityPredictor()

@app.route('/', methods=['GET'])
def health_check():
    """Vérification de santé du service"""
    return jsonify({
        'status': 'healthy',
        'service': 'AirLight AI Prediction Service',
        'version': predictor.model_version,
        'model_trained': predictor.model is not None,
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
        hours_ahead = data.get('hours_ahead', 1)
        
        if len(training_data) < predictor.min_data_points:
            return jsonify({
                'success': False,
                'error': f'Minimum {predictor.min_data_points} points de données requis'
            }), 400
        
        # Entraîner le modèle avec les données fournies
        train_success, train_result = predictor.train_model(training_data)
        
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
        
        logger.info(f"Prédictions générées pour {sensor_id}: {len(predictions)} heures")
        
        return jsonify({
            'success': True,
            'sensor_id': sensor_id,
            'predictions': predictions,
            'model_performance': {
                'mae': train_result['mae'],
                'r2_score': train_result['r2_score'],
                'training_samples': train_result['training_samples'],
                'confidence': np.mean([p['confidence'] for p in predictions]),
                'version': predictor.model_version
            },
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
    """Informations sur le modèle actuel"""
    return jsonify({
        'model_type': 'RandomForestRegressor',
        'version': predictor.model_version,
        'features': predictor.feature_columns,
        'trained': predictor.model is not None,
        'min_data_points': predictor.min_data_points
    })

@app.route('/model/retrain', methods=['POST'])
def retrain_model():
    """Réentraîner le modèle avec de nouvelles données"""
    try:
        data = request.get_json()
        
        if not data or 'data' not in data:
            return jsonify({
                'success': False,
                'error': 'Données d\'entraînement requises'
            }), 400
        
        train_success, train_result = predictor.train_model(data['data'])
        
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

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    debug = os.environ.get('DEBUG', 'False').lower() == 'true'
    
    logger.info(f"Démarrage du service IA sur le port {port}")
    app.run(host='0.0.0.0', port=port, debug=debug)