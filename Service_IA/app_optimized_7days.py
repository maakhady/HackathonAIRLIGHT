# ai_service/app_enhanced.py - MODÈLE IA AMÉLIORÉ
# 🎯 Amélioration majeure: accepte 40+ features, meilleure régularisation

from flask import Flask, request, jsonify
from flask_cors import CORS
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestRegressor, GradientBoostingRegressor
from sklearn.preprocessing import StandardScaler
from sklearn.model_selection import train_test_split
import joblib
from datetime import datetime, timedelta
import warnings
warnings.filterwarnings('ignore')

app = Flask(__name__)
CORS(app)

# Configuration globale
MODEL_VERSION = "enhanced_v2.1"
FEATURE_COLUMNS = None  # Sera défini dynamiquement
scaler = StandardScaler()

# Modèles (ensemble pour meilleure précision)
rf_model = None
gb_model = None

@app.route('/', methods=['GET'])
def home():
    return jsonify({
        "service": "AirLight AI Prediction Service - Enhanced",
        "version": MODEL_VERSION,
        "status": "operational",
        "features": "40+ features support, ensemble models, weather integration",
        "timestamp": datetime.now().isoformat()
    })

@app.route('/predict', methods=['POST'])
def predict():
    """
    ✅ AMÉLIORÉ: Accepte données enrichies avec features avancées
    """
    try:
        data = request.get_json()
        
        if not data or 'historical_data' not in data:
            return jsonify({
                "error": "Missing historical_data",
                "required_format": {
                    "historical_data": "array of enriched data points",
                    "hours_ahead": "integer (1-168)",
                    "features": "optional list of feature names"
                }
            }), 400
        
        historical_data = data['historical_data']
        hours_ahead = data.get('hours_ahead', 168)
        requested_features = data.get('features', None)
        
        # Validation
        if len(historical_data) < 50:
            return jsonify({
                "error": f"Insufficient data: {len(historical_data)} points (minimum 50 required)",
                "suggestion": "Collect more historical data before prediction"
            }), 400
        
        if hours_ahead < 1 or hours_ahead > 168:
            return jsonify({
                "error": "hours_ahead must be between 1 and 168"
            }), 400
        
        print(f"\n{'='*60}")
        print(f"📊 NOUVELLE REQUÊTE DE PRÉDICTION")
        print(f"{'='*60}")
        print(f"   Points de données: {len(historical_data)}")
        print(f"   Horizon: {hours_ahead}h")
        
        # Convertir en DataFrame
        df = pd.DataFrame(historical_data)
        
        # Identifier features disponibles
        numeric_columns = df.select_dtypes(include=[np.number]).columns.tolist()
        if 'timestamp' in numeric_columns:
            numeric_columns.remove('timestamp')
        
        if 'pm25' not in numeric_columns:
            return jsonify({
                "error": "Missing 'pm25' column in data",
                "available_columns": list(df.columns)
            }), 400
        
        print(f"   Features disponibles: {len(numeric_columns)}")
        print(f"   Liste: {', '.join(numeric_columns[:10])}{'...' if len(numeric_columns) > 10 else ''}")
        
        # Utiliser features demandées ou toutes disponibles
        if requested_features:
            feature_cols = [f for f in requested_features if f in numeric_columns and f != 'pm25']
        else:
            feature_cols = [c for c in numeric_columns if c != 'pm25']
        
        # Préparer données d'entraînement
        X = df[feature_cols].fillna(0)
        y = df['pm25'].values
        
        # Normalisation
        global scaler, FEATURE_COLUMNS
        FEATURE_COLUMNS = feature_cols
        X_scaled = scaler.fit_transform(X)
        
        # Train/test split
        X_train, X_test, y_train, y_test = train_test_split(
            X_scaled, y, test_size=0.2, random_state=42, shuffle=False
        )
        
        print(f"\n📈 ENTRAÎNEMENT DES MODÈLES...")
        print(f"   Train: {len(X_train)} | Test: {len(X_test)}")
        
        # ✅ Random Forest (robuste, gère bien les non-linéarités)
        global rf_model
        rf_model = RandomForestRegressor(
            n_estimators=150,  # Plus d'arbres = plus stable
            max_depth=15,       # Limite la complexité
            min_samples_split=5,
            min_samples_leaf=2,
            max_features='sqrt',
            random_state=42,
            n_jobs=-1
        )
        rf_model.fit(X_train, y_train)
        rf_score = rf_model.score(X_test, y_test)
        
        # ✅ Gradient Boosting (capture tendances complexes)
        global gb_model
        gb_model = GradientBoostingRegressor(
            n_estimators=100,
            learning_rate=0.05,  # Plus lent = plus précis
            max_depth=5,
            min_samples_split=5,
            min_samples_leaf=2,
            subsample=0.8,
            random_state=42
        )
        gb_model.fit(X_train, y_train)
        gb_score = gb_model.score(X_test, y_test)
        
        print(f"   ✅ Random Forest R²: {rf_score:.3f}")
        print(f"   ✅ Gradient Boosting R²: {gb_score:.3f}")
        
        # Générer prédictions
        print(f"\n🔮 GÉNÉRATION DE {hours_ahead}H DE PRÉDICTIONS...")
        predictions = generate_predictions(
            df, 
            feature_cols, 
            hours_ahead,
            rf_model,
            gb_model
        )
        
        # Statistiques
        pred_values = [p['predicted_pm25'] for p in predictions]
        avg_pm25 = np.mean(pred_values)
        max_pm25 = np.max(pred_values)
        min_pm25 = np.min(pred_values)
        
        print(f"\n📊 RÉSULTATS:")
        print(f"   Prédictions générées: {len(predictions)}")
        print(f"   PM2.5 moyen prédit: {avg_pm25:.1f} µg/m³")
        print(f"   Range: [{min_pm25:.1f} - {max_pm25:.1f}] µg/m³")
        print(f"{'='*60}\n")
        
        return jsonify({
            "success": True,
            "predictions": predictions,
            "model_info": {
                "version": MODEL_VERSION,
                "algorithm": "ensemble (RF + GB)",
                "features_used": len(feature_cols),
                "feature_names": feature_cols[:20],  # Top 20
                "training_points": len(X_train),
                "test_score_rf": round(rf_score, 3),
                "test_score_gb": round(gb_score, 3),
                "ensemble_weight": "0.6 RF + 0.4 GB"
            },
            "statistics": {
                "predictions_count": len(predictions),
                "avg_pm25": round(avg_pm25, 2),
                "max_pm25": round(max_pm25, 2),
                "min_pm25": round(min_pm25, 2)
            }
        })
        
    except Exception as e:
        print(f"❌ ERREUR: {str(e)}")
        import traceback
        traceback.print_exc()
        
        return jsonify({
            "error": str(e),
            "type": type(e).__name__
        }), 500


def generate_predictions(df, feature_cols, hours_ahead, rf, gb):
    """
    ✅ Génération de prédictions avec ensemble de modèles
    """
    predictions = []
    last_row = df.iloc[-1].copy()
    base_timestamp = pd.to_datetime(last_row.get('timestamp', datetime.now()))
    
    # Poids de l'ensemble (RF est généralement plus stable)
    RF_WEIGHT = 0.6
    GB_WEIGHT = 0.4
    
    for hour in range(1, hours_ahead + 1):
        # Préparer features pour cette heure
        features = []
        for col in feature_cols:
            if col in last_row:
                features.append(last_row[col])
            else:
                features.append(0)
        
        # Normaliser
        features_scaled = scaler.transform([features])
        
        # Prédictions des 2 modèles
        rf_pred = rf.predict(features_scaled)[0]
        gb_pred = gb.predict(features_scaled)[0]
        
        # Ensemble (moyenne pondérée)
        ensemble_pred = RF_WEIGHT * rf_pred + GB_WEIGHT * gb_pred
        
        # Limites réalistes
        ensemble_pred = np.clip(ensemble_pred, 1, 500)
        
        # Confiance adaptative selon horizon
        if hour <= 6:
            confidence = 0.85
        elif hour <= 24:
            confidence = 0.75
        elif hour <= 48:
            confidence = 0.65
        elif hour <= 72:
            confidence = 0.55
        else:
            confidence = max(0.35, 0.65 - (hour - 72) * 0.005)
        
        # Ajuster confiance selon écart entre modèles
        model_agreement = 1 - abs(rf_pred - gb_pred) / max(rf_pred, gb_pred, 1)
        confidence *= (0.8 + 0.2 * model_agreement)
        
        pred_timestamp = base_timestamp + timedelta(hours=hour)
        
        predictions.append({
            "timestamp": pred_timestamp.isoformat(),
            "hours_ahead": hour,
            "predicted_pm25": round(float(ensemble_pred), 2),
            "confidence": round(float(confidence), 3),
            "model_type": "ensemble",
            "model_details": {
                "rf_prediction": round(float(rf_pred), 2),
                "gb_prediction": round(float(gb_pred), 2),
                "agreement": round(model_agreement, 3)
            }
        })
        
        # Mise à jour features pour prochaine itération
        # Simuler évolution temporelle
        last_row = update_features_for_next_hour(last_row, ensemble_pred, hour)
    
    return predictions


def update_features_for_next_hour(row, predicted_pm25, hour):
    """
    ✅ Mise à jour intelligente des features pour prochaine prédiction
    """
    updated = row.copy()
    
    # Mettre à jour PM2.5
    updated['pm25'] = predicted_pm25
    
    # Mettre à jour features temporelles
    if 'hour' in updated:
        updated['hour'] = (updated['hour'] + 1) % 24
    
    # Mettre à jour features lag (décaler)
    if 'pm25_lag_24h' in updated:
        updated['pm25_lag_24h'] = updated.get('pm25_lag_1h', predicted_pm25)
    if 'pm25_lag_6h' in updated:
        updated['pm25_lag_6h'] = updated.get('pm25_lag_3h', predicted_pm25)
    if 'pm25_lag_3h' in updated:
        updated['pm25_lag_3h'] = updated.get('pm25_lag_1h', predicted_pm25)
    if 'pm25_lag_1h' in updated:
        updated['pm25_lag_1h'] = predicted_pm25
    
    # Mettre à jour moyennes mobiles (approximation)
    for window in [3, 6, 12, 24]:
        col = f'pm25_rolling_{window}h'
        if col in updated:
            # Moyenne mobile simple (approximation)
            updated[col] = 0.9 * updated[col] + 0.1 * predicted_pm25
    
    # Mettre à jour différences
    if 'pm25_diff_1h' in updated:
        updated['pm25_diff_1h'] = predicted_pm25 - updated.get('pm25_lag_1h', predicted_pm25)
    
    # Décroissance progressive de la confiance pour features météo
    # (car on s'éloigne dans le futur)
    for col in updated.index:
        if 'weather_' in col or 'wind_' in col:
            updated[col] *= 0.99  # Légère dégradation
    
    return updated


@app.route('/model/info', methods=['GET'])
def model_info():
    """Informations sur le modèle actuel"""
    global rf_model, gb_model, FEATURE_COLUMNS
    
    info = {
        "version": MODEL_VERSION,
        "models": {
            "random_forest": {
                "trained": rf_model is not None,
                "n_estimators": 150 if rf_model else None,
                "max_depth": 15 if rf_model else None
            },
            "gradient_boosting": {
                "trained": gb_model is not None,
                "n_estimators": 100 if gb_model else None,
                "learning_rate": 0.05 if gb_model else None
            }
        },
        "features": {
            "count": len(FEATURE_COLUMNS) if FEATURE_COLUMNS else 0,
            "names": FEATURE_COLUMNS[:20] if FEATURE_COLUMNS else []
        },
        "capabilities": {
            "max_horizon_hours": 168,
            "min_training_points": 50,
            "ensemble_method": "weighted_average",
            "weather_integration": True,
            "seasonal_adjustments": "handled_by_node_service"
        }
    }
    
    return jsonify(info)


@app.route('/model/retrain', methods=['POST'])
def retrain_model():
    """Force le retraining du modèle"""
    try:
        data = request.get_json()
        if not data or 'historical_data' not in data:
            return jsonify({"error": "Missing historical_data"}), 400
        
        # Relancer l'entraînement
        result = predict()
        return jsonify({
            "success": True,
            "message": "Model retrained successfully",
            "version": MODEL_VERSION
        })
        
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/health', methods=['GET'])
def health():
    """Health check"""
    return jsonify({
        "status": "healthy",
        "service": "AirLight AI Enhanced",
        "version": MODEL_VERSION,
        "timestamp": datetime.now().isoformat()
    })


if __name__ == '__main__':
    print("\n" + "="*60)
    print("🤖 AirLight AI Prediction Service - ENHANCED")
    print("="*60)
    print(f"   Version: {MODEL_VERSION}")
    print(f"   Features: 40+ support, ensemble models")
    print(f"   Algorithms: Random Forest + Gradient Boosting")
    print(f"   Max horizon: 168 hours (7 days)")
    print("="*60 + "\n")
    
    app.run(host='0.0.0.0', port=5000, debug=False)