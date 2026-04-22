# Service_IA/gunicorn.conf.py
# Configuration optimisée pour Render Free (512MB RAM)

import os

# Module WSGI — pointe vers le vrai service IA v3
wsgi_app = "app_optimized_7days:app"

# Bind — utilise $PORT si défini (Render), sinon 5000 (local)
import os
bind = f"0.0.0.0:{os.environ.get('PORT', '5000')}"

# Workers - UN SEUL pour économiser RAM
workers = 1
threads = 1
worker_class = "sync"

# Timeout - 5 minutes pour ML
timeout = 300
graceful_timeout = 30
keepalive = 5

# Memory management
max_requests = 50          # Redémarre après 50 requêtes (libère mémoire)
max_requests_jitter = 10
preload_app = True
worker_tmp_dir = "/dev/shm"  # RAM partagée

# Logs
accesslog = "-"
errorlog = "-"
loglevel = "info"
access_log_format = '%(h)s %(l)s %(u)s %(t)s "%(r)s" %(s)s %(b)s "%(f)s" "%(a)s"'

# Process naming
proc_name = "airlight-ai"

print("=" * 60)
print("🚀 Gunicorn configuration loaded")
print(f"   Workers: {workers}")
print(f"   Threads: {threads}")
print(f"   Timeout: {timeout}s")
print(f"   Max requests: {max_requests}")
print("=" * 60)                          