import json
from datetime import datetime, timedelta
import random

base_time = datetime.now() - timedelta(days=7)
data = []

for i in range(168):
    current_time = base_time + timedelta(hours=i)
    hour = current_time.hour
    
    pm25_base = 35 + 15 * (0.5 if 7 <= hour <= 9 or 17 <= hour <= 19 else 0)
    pm25 = max(5, pm25_base + random.uniform(-10, 15))
    
    data.append({
        "timestamp": current_time.isoformat() + 'Z',
        "pm25": round(pm25, 2),
        "pm10": round(pm25 * 1.8, 2),
        "co2": round(450 + random.uniform(-50, 100), 2),
        "temperature": round(28 + random.uniform(-3, 5), 2),
        "humidity": round(65 + random.uniform(-10, 10), 2),
        "hour": hour,
        "dayOfWeek": current_time.weekday(),
        "month": current_time.month,
        "aqi": round(max(0, pm25 * 2 + random.uniform(-10, 10)), 2)
    })

api_request = {
    "sensorId": "sensor-dakar-plateau-001",
    "hours_ahead": 168,
    "use_ensemble": True,
    "data": data
}

with open('test_api_168h.json', 'w') as f:
    json.dump(api_request, f, indent=2)

print(f"✅ Fichier test_api_168h.json créé avec {len(data)} points")
print(f"📊 Taille: {len(json.dumps(api_request)) / 1024:.1f} KB")
