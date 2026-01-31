#!/usr/bin/env python3
# test_flask_service.py - Tester le service IA directement

import requests
import json
from datetime import datetime, timedelta

print("🧪 Test du service IA Flask\n")

# 1. Vérifier que le service répond
print("1️⃣ Test health check...")
try:
    response = requests.get("http://localhost:5000/")
    if response.status_code == 200:
        data = response.json()
        print(f"✅ Service disponible")
        print(f"   Version: {data.get('version')}")
        print(f"   Max hours: {data.get('max_hours_ahead')}")
        print(f"   Models: {data.get('models_available')}")
    else:
        print(f"❌ Erreur: {response.status_code}")
        exit(1)
except Exception as e:
    print(f"❌ Service IA inaccessible: {e}")
    print("\n💡 Solution: Lancez le service IA avec:")
    print("   cd ai_service")
    print("   python app_optimized_7days.py")
    exit(1)

print("\n2️⃣ Test prédiction 168h avec données simulées...")

# Créer des données de test
base_time = datetime.now()
test_data = []

for i in range(72):  # 72h de données historiques
    timestamp = base_time - timedelta(hours=72-i)
    test_data.append({
        "timestamp": timestamp.isoformat(),
        "pm25": 15.0 + (i % 10) * 0.5,  # Variation simulée
        "pm10": 25.0 + (i % 10) * 0.8,
        "co2": 450 + (i % 20) * 5,
        "temperature": 28 + (i % 5) * 0.3,
        "humidity": 60 + (i % 10) * 2,
        "tvoc": 100,
        "nox": 10,
        "hour": timestamp.hour,
        "dayOfWeek": timestamp.weekday(),
        "month": timestamp.month,
        "aqi": 52 + (i % 10) * 2,
        "qualityLevel": "moderate"
    })

payload = {
    "sensorId": "test_sensor_001",
    "data": test_data,
    "hours_ahead": 168,
    "use_ensemble": True
}

print(f"   📊 Données test: {len(test_data)} points historiques")
print(f"   🎯 Prédiction demandée: 168 heures (7 jours)")

try:
    response = requests.post(
        "http://localhost:5000/predict",
        json=payload,
        timeout=120  # 2 minutes max
    )
    
    if response.status_code == 200:
        result = response.json()
        
        if result.get('success'):
            predictions = result.get('predictions', [])
            print(f"\n✅ Prédictions générées avec succès!")
            print(f"   - Nombre de prédictions: {len(predictions)}")
            print(f"   - Heures prédites: {result.get('hours_predicted')}")
            
            if len(predictions) >= 168:
                print(f"   ✅ Service IA génère bien 168h de prédictions")
            else:
                print(f"   ⚠️ Seulement {len(predictions)} prédictions au lieu de 168")
            
            # Afficher quelques prédictions
            print(f"\n   📊 Premières prédictions:")
            for i in [0, 23, 71, 167]:
                if i < len(predictions):
                    p = predictions[i]
                    print(f"      Heure {p['hour_ahead']:3d}: PM2.5={p['predicted_pm25']:.1f}, AQI={p['predicted_aqi']:.0f}, Confiance={p['confidence']:.2f}")
            
            # Stats
            stats = result.get('statistics', {})
            print(f"\n   📈 Statistiques:")
            print(f"      - PM2.5 moyen: {stats.get('mean', 0):.1f}")
            print(f"      - PM2.5 min/max: {stats.get('min', 0):.1f} / {stats.get('max', 0):.1f}")
            print(f"      - Confiance moyenne: {stats.get('confidence', {}).get('mean', 0):.2f}")
            
            print(f"\n✅ Le service IA Flask fonctionne correctement!")
            
        else:
            print(f"❌ Échec génération: {result.get('error')}")
            
    else:
        print(f"❌ Erreur HTTP {response.status_code}")
        print(f"   Réponse: {response.text[:200]}")
        
except requests.exceptions.Timeout:
    print("❌ Timeout - Le service IA prend trop de temps")
    print("   💡 C'est normal pour la première prédiction (entraînement du modèle)")
    print("   Relancez le test")
    
except Exception as e:
    print(f"❌ Erreur: {e}")

print("\n" + "="*70)
print("💡 Conclusion:")
print("="*70)
print("Si ✅ : Le service IA fonctionne → Le problème est dans Node.js")
print("Si ❌ : Le service IA ne fonctionne pas → À corriger d'abord")