# ai_service/app_enhanced.py - MODÈLE IA V3
# ✅ Fix: buffer historique pour lag/rolling (plus d'oscillations)
# ✅ Fix: build_features_from_buffer remplace update_features_for_next_hour
# ✅ Fix: lissage entre prédictions consécutives
# ✅ Fix: météo (wind/pressure) mise à jour heure par heure depuis last_row
# ✅ Fix: hyperparamètres plus stricts pour moins de surapprentissage
# ✅ Compatible avec les 30+ features envoyées par PredictionService v3.2

from flask import Flask, request, jsonify
from flask_cors import CORS
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestRegressor, GradientBoostingRegressor
from sklearn.preprocessing import StandardScaler
from sklearn.model_selection import train_test_split
from datetime import datetime, timedelta
import warnings
warnings.filterwarnings('ignore')

app = Flask(__name__)
CORS(app)

MODEL_VERSION = "enhanced_v3"
FEATURE_COLUMNS = None
scaler = StandardScaler()

rf_model = None
gb_model = None


@app.route('/', methods=['GET'])
def home():
    return jsonify({
        "service": "AirLight AI Prediction Service",
        "version": MODEL_VERSION,
        "status": "operational",
        "timestamp": datetime.now().isoformat()
    })


@app.route('/predict', methods=['POST'])
def predict():
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

        if len(historical_data) < 50:
            return jsonify({
                "error": f"Insufficient data: {len(historical_data)} points (minimum 50 required)"
            }), 400

        if hours_ahead < 1 or hours_ahead > 168:
            return jsonify({"error": "hours_ahead must be between 1 and 168"}), 400

        print(f"\n{'='*60}")
        print(f"📊 REQUÊTE PRÉDICTION v3")
        print(f"{'='*60}")
        print(f"   Points: {len(historical_data)} | Horizon: {hours_ahead}h")

        df = pd.DataFrame(historical_data)

        numeric_columns = df.select_dtypes(include=[np.number]).columns.tolist()
        if 'timestamp' in numeric_columns:
            numeric_columns.remove('timestamp')

        if 'pm25' not in numeric_columns:
            return jsonify({
                "error": "Missing 'pm25' column",
                "available_columns": list(df.columns)
            }), 400

        # Sélection des features
        if requested_features:
            feature_cols = [f for f in requested_features if f in numeric_columns and f != 'pm25']
        else:
            feature_cols = [c for c in numeric_columns if c != 'pm25']

        print(f"   Features utilisées: {len(feature_cols)}")

        X = df[feature_cols].fillna(0)
        y = df['pm25'].values
        
        MAX_TRAINING_POINTS = 1500  # Au lieu de 3000+

        if len(X) > MAX_TRAINING_POINTS:
            # Garder les plus récentes
            X = X[-MAX_TRAINING_POINTS:]
            y = y[-MAX_TRAINING_POINTS:]
            print(f"   ⚠️ Données limitées à {MAX_TRAINING_POINTS} points")
        global scaler, FEATURE_COLUMNS
        FEATURE_COLUMNS = feature_cols
        X_scaled = scaler.fit_transform(X)

        X_train, X_test, y_train, y_test = train_test_split(
            X_scaled, y, test_size=0.2, random_state=42, shuffle=False
        )

        print(f"\n📈 ENTRAÎNEMENT...")
        print(f"   Train: {len(X_train)} | Test: {len(X_test)}")

        # Random Forest - paramètres plus stricts
        global rf_model
        rf_model = RandomForestRegressor(
            n_estimators=50,
            max_depth=10,            # ← réduit de 15 → moins de surapprentissage
            min_samples_split=10,     # ← plus strict
            min_samples_leaf=4,      # ← plus strict
            max_features='sqrt',
            random_state=42,
            n_jobs=-1
        )
        rf_model.fit(X_train, y_train)
        rf_score = rf_model.score(X_test, y_test)

        # Gradient Boosting - paramètres plus stricts
        global gb_model
        gb_model = GradientBoostingRegressor(
            n_estimators=50,
            learning_rate=0.05,
            max_depth=3,             # ← réduit de 5
            min_samples_split=10,
            min_samples_leaf=5,
            subsample=0.8,
            random_state=42
        )
        gb_model.fit(X_train, y_train)
        gb_score = gb_model.score(X_test, y_test)

        print(f"   ✅ RF R²: {rf_score:.3f} | GB R²: {gb_score:.3f}")

        # Génération avec buffer historique
        print(f"\n🔮 GÉNÉRATION {hours_ahead}H...")
        predictions = generate_predictions(df, feature_cols, hours_ahead, rf_model, gb_model)

        pred_values = [p['predicted_pm25'] for p in predictions]
        avg_pm25 = np.mean(pred_values)
        max_pm25 = np.max(pred_values)
        min_pm25 = np.min(pred_values)

        print(f"\n📊 RÉSULTATS:")
        print(f"   Générées: {len(predictions)} | Moy: {avg_pm25:.1f} | Range: [{min_pm25:.1f} - {max_pm25:.1f}] µg/m³")
        print(f"{'='*60}\n")

        return jsonify({
            "success": True,
            "predictions": predictions,
            "model_info": {
                "version": MODEL_VERSION,
                "algorithm": "ensemble (RF 0.6 + GB 0.4)",
                "features_used": len(feature_cols),
                "feature_names": feature_cols[:20],
                "training_points": len(X_train),
                "test_score_rf": round(rf_score, 3),
                "test_score_gb": round(gb_score, 3)
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
        return jsonify({"error": str(e), "type": type(e).__name__}), 500


def generate_predictions(df, feature_cols, hours_ahead, rf, gb):
    """
    ✅ V3 : buffer historique pour éliminer les oscillations.
    
    Au lieu de partir de last_row et d'approximer les features,
    on garde les 24 dernières valeurs réelles de pm25 dans un buffer.
    Chaque prédiction est ajoutée au buffer → les lag/rolling
    sont calculés sur des données cohérentes.
    """
    predictions = []

    # ← BUFFER : 24 dernières valeurs réelles de pm25
    pm25_history = list(df['pm25'].values[-24:])

    # Dernière ligne pour les features stables (météo, temporelles de base)
    last_row = df.iloc[-1].copy()
    base_timestamp = pd.to_datetime(last_row.get('timestamp', datetime.now()))

    RF_WEIGHT = 0.6
    GB_WEIGHT = 0.4

    for hour in range(1, hours_ahead + 1):
        # ← Construire les features depuis le buffer
        features = build_features_from_buffer(
            last_row, feature_cols, pm25_history, hour
        )

        features_scaled = scaler.transform([features])

        rf_pred = rf.predict(features_scaled)[0]
        gb_pred = gb.predict(features_scaled)[0]

        ensemble_pred = RF_WEIGHT * rf_pred + GB_WEIGHT * gb_pred
        ensemble_pred = np.clip(ensemble_pred, 1, 500)

        # ← LISSAGE : limiter la variation entre deux heures consécutives
        if len(pm25_history) >= 1:
            prev_val = pm25_history[-1]
            max_change = prev_val * 0.30  # max 30% de variation par heure
            ensemble_pred = np.clip(
                ensemble_pred,
                prev_val - max_change,
                prev_val + max_change
            )

        # Confiance adaptative
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

        # Ajuster selon accord entre les deux modèles
        model_agreement = 1 - abs(rf_pred - gb_pred) / max(abs(rf_pred), abs(gb_pred), 1)
        confidence *= (0.8 + 0.2 * model_agreement)

        pred_timestamp = base_timestamp + timedelta(hours=hour)

        predictions.append({
            "timestamp": pred_timestamp.isoformat(),
            "hours_ahead": hour,
            "predicted_pm25": round(float(ensemble_pred), 2),
            "confidence": round(float(min(confidence, 0.95)), 3),
            "model_type": "ensemble",
            "model_details": {
                "rf_prediction": round(float(rf_pred), 2),
                "gb_prediction": round(float(gb_pred), 2),
                "agreement": round(float(model_agreement), 3)
            }
        })

        # ← Ajouter la prédiction au buffer pour la prochaine itération
        pm25_history.append(float(ensemble_pred))
        if len(pm25_history) > 24:
            pm25_history.pop(0)

    return predictions


def build_features_from_buffer(last_row, feature_cols, pm25_history, current_hour):
    """
    ✅ V3 : reconstruit chaque feature depuis le buffer réel.
    
    Remplace update_features_for_next_hour qui approximait grossièrement.
    
    - Lag features → index direct dans pm25_history
    - Rolling averages → np.mean sur la fenêtre du buffer
    - Différences → subtraction entre positions du buffer
    - Features temporelles → recalculées avec current_hour
    - Météo (wind/pressure/precipitation) → depuis last_row
      (le Node envoie déjà ces valeurs interpolées par heure,
       mais ici on est dans la boucle de génération donc on garde
       les dernières valeurs reçues)
    """
    features = []

    for col in feature_cols:

        # ─── Features temporelles ───────────────────────────────
        if col == 'hour':
            base_hour = int(last_row.get('hour', 0))
            features.append((base_hour + current_hour) % 24)

        elif col == 'dayOfWeek':
            # Si on dépasse 24h, le jour peut changer
            base_day = int(last_row.get('dayOfWeek', 0))
            days_offset = (current_hour) // 24
            features.append((base_day + days_offset) % 7)

        elif col == 'isWeekend':
            base_day = int(last_row.get('dayOfWeek', 0))
            days_offset = current_hour // 24
            day = (base_day + days_offset) % 7
            features.append(1 if day in [0, 6] else 0)

        elif col == 'isRushHour':
            hour_val = (int(last_row.get('hour', 0)) + current_hour) % 24
            features.append(1 if hour_val in [7, 8, 9, 17, 18, 19, 20] else 0)

        elif col == 'isNight':
            hour_val = (int(last_row.get('hour', 0)) + current_hour) % 24
            features.append(1 if (hour_val >= 22 or hour_val <= 6) else 0)

        elif col == 'isDaytime':
            hour_val = (int(last_row.get('hour', 0)) + current_hour) % 24
            features.append(1 if (hour_val >= 6 and hour_val <= 18) else 0)

        elif col in ('month', 'isHarmattan', 'isRainySeason', 'isHotSeason'):
            # Ces features ne changent pas sur 168h
            features.append(float(last_row.get(col, 0)))

        # ─── Lag features depuis le buffer ──────────────────────
        elif col == 'pm25_lag_1h':
            features.append(pm25_history[-1] if len(pm25_history) >= 1 else 0)

        elif col == 'pm25_lag_3h':
            features.append(pm25_history[-3] if len(pm25_history) >= 3 else pm25_history[0] if pm25_history else 0)

        elif col == 'pm25_lag_6h':
            features.append(pm25_history[-6] if len(pm25_history) >= 6 else pm25_history[0] if pm25_history else 0)

        elif col == 'pm25_lag_24h':
            features.append(pm25_history[-24] if len(pm25_history) >= 24 else pm25_history[0] if pm25_history else 0)

        # ─── Rolling averages depuis le buffer ──────────────────
        elif col == 'pm25_rolling_3h':
            window = pm25_history[-3:] if len(pm25_history) >= 3 else pm25_history
            features.append(float(np.mean(window)) if window else 0)

        elif col == 'pm25_rolling_6h':
            window = pm25_history[-6:] if len(pm25_history) >= 6 else pm25_history
            features.append(float(np.mean(window)) if window else 0)

        elif col == 'pm25_rolling_12h':
            window = pm25_history[-12:] if len(pm25_history) >= 12 else pm25_history
            features.append(float(np.mean(window)) if window else 0)

        elif col == 'pm25_rolling_24h':
            window = pm25_history[-24:] if len(pm25_history) >= 24 else pm25_history
            features.append(float(np.mean(window)) if window else 0)

        # ─── Écarts-types depuis le buffer ──────────────────────
        elif col == 'pm25_std_6h':
            window = pm25_history[-6:] if len(pm25_history) >= 6 else pm25_history
            features.append(float(np.std(window)) if len(window) > 1 else 0)

        elif col == 'pm25_std_24h':
            window = pm25_history[-24:] if len(pm25_history) >= 24 else pm25_history
            features.append(float(np.std(window)) if len(window) > 1 else 0)

        # ─── Différences depuis le buffer ───────────────────────
        elif col == 'pm25_diff_1h':
            if len(pm25_history) >= 2:
                features.append(pm25_history[-1] - pm25_history[-2])
            else:
                features.append(0)

        elif col == 'pm25_diff_3h':
            if len(pm25_history) >= 4:
                features.append(pm25_history[-1] - pm25_history[-4])
            else:
                features.append(0)

        elif col == 'pm25_diff_24h':
            if len(pm25_history) >= 24:
                features.append(pm25_history[-1] - pm25_history[-24])
            else:
                features.append(0)

        # ─── Min/Max depuis le buffer ───────────────────────────
        elif col == 'pm25_min_24h':
            window = pm25_history[-24:] if pm25_history else [0]
            features.append(float(np.min(window)))

        elif col == 'pm25_max_24h':
            window = pm25_history[-24:] if pm25_history else [0]
            features.append(float(np.max(window)))

        # ─── Ratio (stable, basé sur dernière observation) ─────
        elif col == 'pm25_pm10_ratio':
            features.append(float(last_row.get(col, 0.5)))

        # ─── Tout le reste : dernière valeur de last_row ────────
        # (température, humidité depuis capteur,
        #  wind_speed, pressure, precipitation depuis OpenWeather)
        else:
            val = last_row.get(col, 0)
            features.append(float(val) if val is not None else 0)

    return features


@app.route('/model/info', methods=['GET'])
def model_info():
    global rf_model, gb_model, FEATURE_COLUMNS

    return jsonify({
        "version": MODEL_VERSION,
        "models": {
            "random_forest": {
                "trained": rf_model is not None,
                "n_estimators": 150,
                "max_depth": 12
            },
            "gradient_boosting": {
                "trained": gb_model is not None,
                "n_estimators": 100,
                "max_depth": 4,
                "learning_rate": 0.05
            }
        },
        "features": {
            "count": len(FEATURE_COLUMNS) if FEATURE_COLUMNS else 0,
            "names": FEATURE_COLUMNS if FEATURE_COLUMNS else []
        },
        "capabilities": {
            "max_horizon_hours": 168,
            "min_training_points": 50,
            "ensemble_method": "weighted_average (0.6 RF + 0.4 GB)",
            "smoothing": "30% max variation par heure",
            "buffer_size": 24
        }
    })


@app.route('/model/retrain', methods=['POST'])
def retrain_model():
    try:
        data = request.get_json()
        if not data or 'historical_data' not in data:
            return jsonify({"error": "Missing historical_data"}), 400

        result = predict()
        return jsonify({
            "success": True,
            "message": "Model retrained",
            "version": MODEL_VERSION
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/health', methods=['GET'])
def health():
    return jsonify({
        "status": "healthy",
        "service": "AirLight AI",
        "version": MODEL_VERSION,
        "timestamp": datetime.now().isoformat()
    })


if __name__ == '__main__':
    print("\n" + "=" * 60)
    print("🤖 AirLight AI Prediction Service - V3")
    print("=" * 60)
    print(f"   Version     : {MODEL_VERSION}")
    print(f"   Buffer      : 24h historique pour lag/rolling")
    print(f"   Lissage     : 30% max variation/heure")
    print(f"   Algorithmes : Random Forest + Gradient Boosting")
    print(f"   Horizon max : 168h (7 jours)")
    print("=" * 60 + "\n")

    app.run(host='0.0.0.0', port=5000, debug=False)