import sys
sys.path.insert(0, '.')
from app_optimized_7days import AirQualityPredictor
from datetime import datetime, timedelta
import numpy as np

# Données minimales pour test
base_time = datetime.now() - timedelta(hours=48)
data = []

for i in range(48):
    current_time = base_time + timedelta(hours=i)
    hour = current_time.hour
    pm25 = 35 + np.random.uniform(-10, 10)
    
    data.append({
        'timestamp': current_time.isoformat() + 'Z',
        'pm25': pm25, 
        'pm10': pm25 * 1.8, 
        'co2': 450,
        'temperature': 28, 
        'humidity': 65,
        'hour': hour, 
        'dayOfWeek': current_time.weekday(), 
        'month': current_time.month,
        'aqi': pm25 * 2
    })

print(f"📊 Test avec {len(data)} points")

predictor = AirQualityPredictor()

# Test prepare_features seul
print("\n🔧 Test prepare_features:")
result = predictor.prepare_features(data, horizon='short')
print(f"   Type retour: {type(result)}")
print(f"   Contenu: {type(result[0]) if isinstance(result, tuple) else 'pas un tuple'}")

if isinstance(result, tuple) and result[1] is None:
    print(f"   ✅ DataFrame shape: {result[0].shape}")
else:
    print(f"   ❌ Erreur: {result[1] if isinstance(result, tuple) else result}")

# Entraînement
print("\n🎯 Entraînement:")
success, metrics = predictor.train_model(data)
print(f"   ✅ R²: {metrics['r2_score']:.3f}")

# Prédiction
print("\n🔮 Prédiction:")
try:
    predictions, error = predictor.predict(data, hours_ahead=3)
    if error:
        print(f"   ❌ Erreur: {error}")
    else:
        print(f"   ✅ {len(predictions)} prédictions OK")
        print(f"   Premier résultat: {predictions[0]}")
except Exception as e:
    print(f"   ❌ Exception: {e}")
    import traceback
    traceback.print_exc()
