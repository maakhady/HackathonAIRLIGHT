import sys
sys.path.insert(0, '.')
from app_optimized_7days import AirQualityPredictor
from datetime import datetime, timedelta
import numpy as np

# 7 jours de données
base_time = datetime.now() - timedelta(days=7)
data = []

for i in range(7 * 24):
    current_time = base_time + timedelta(hours=i)
    hour = current_time.hour
    
    pm25_base = 35 + 15 * np.sin((hour - 6) * np.pi / 12)
    pm25_base += 10 if 7 <= hour <= 9 or 17 <= hour <= 19 else 0
    pm25 = max(5, pm25_base + np.random.uniform(-5, 5))
    
    data.append({
        'timestamp': current_time.isoformat() + 'Z',
        'pm25': pm25, 
        'pm10': pm25 * 1.8, 
        'co2': 450 + np.random.uniform(-50, 100),
        'temperature': 28 + 5 * np.sin((hour - 14) * np.pi / 12),
        'humidity': 65 + np.random.uniform(-10, 10),
        'hour': hour, 
        'dayOfWeek': current_time.weekday(), 
        'month': current_time.month,
        'aqi': max(0, pm25 * 2 + np.random.uniform(-10, 10))
    })

print(f"📊 Entraînement avec {len(data)} points (7 jours)\n")

predictor = AirQualityPredictor()
success, metrics = predictor.train_model(data)

print(f"✅ R²: {metrics['r2_score']:.3f}")
print(f"✅ MAE: {metrics['mae']:.2f}")
print(f"✅ RMSE: {metrics['rmse']:.2f}\n")

# Prédiction 168h
print("🔮 Génération de 168h de prédictions...\n")
predictions, error = predictor.predict(data, hours_ahead=168)

if error:
    print(f"❌ Erreur: {error}")
else:
    print(f"✅ {len(predictions)} prédictions générées!\n")
    
    # Statistiques par horizon
    short = [p for p in predictions if p['horizon'] == 'short']
    medium = [p for p in predictions if p['horizon'] == 'medium']
    long = [p for p in predictions if p['horizon'] == 'long']
    
    print("📊 Statistiques par horizon:")
    print(f"   Court terme (0-24h): {len(short)} prédictions")
    print(f"      Confiance moyenne: {np.mean([p['confidence'] for p in short]):.2f}")
    print(f"      PM2.5 moyenne: {np.mean([p['predicted_pm25'] for p in short]):.1f}")
    
    print(f"\n   Moyen terme (24-72h): {len(medium)} prédictions")
    print(f"      Confiance moyenne: {np.mean([p['confidence'] for p in medium]):.2f}")
    print(f"      PM2.5 moyenne: {np.mean([p['predicted_pm25'] for p in medium]):.1f}")
    
    print(f"\n   Long terme (72-168h): {len(long)} prédictions")
    print(f"      Confiance moyenne: {np.mean([p['confidence'] for p in long]):.2f}")
    print(f"      PM2.5 moyenne: {np.mean([p['predicted_pm25'] for p in long]):.1f}")
    
    # Performance
    stats = predictor.get_performance_stats()
    print(f"\n⚡ Performance:")
    print(f"   Total prédictions: {stats['total_predictions']}")
    print(f"   Temps moyen: {stats['avg_prediction_time']:.2f}s")
    print(f"   Cache hits: {stats['cache_hits']}")
