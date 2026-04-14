import os
import sys
import logging
from typing import Dict, Any

# Ensure we can import from app
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__))))

from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger("verify_setup")

def verify_environment():
    """
    Diagnostic script to check environment health on Azure App Service.
    """
    print("\n" + "="*50)
    print("🔍 AI BACKEND ENVIRONMENT DIAGNOSTIC")
    print("="*50)
    
    # 1. Check Core Settings
    critical_vars = [
        "APP_ENV",
        "MONGO_URI",
        "REDIS_URL",
        "OPENAI_API_KEY",
        "INTERNAL_SECRET",
        "NODE_BACKEND_URL",
        "APPLICATIONINSIGHTS_CONNECTION_STRING"
    ]
    
    missing = []
    for var in critical_vars:
        val = getattr(settings, var, None)
        if not val:
            print(f"❌ {var}: MISSING")
            missing.append(var)
        else:
            # Mask sensitive values
            masked = str(val)[:5] + "..." + str(val)[-5:] if len(str(val)) > 10 else "***"
            print(f"✅ {var}: {masked}")
            
    # 2. Test MongoDB connectivity
    print("\n📦 Testing MongoDB Connection...")
    try:
        from pymongo import MongoClient
        client = MongoClient(settings.MONGO_URI, serverSelectionTimeoutMS=5000)
        client.admin.command('ping')
        print("✅ MongoDB: CONNECTED")
    except Exception as e:
        print(f"❌ MongoDB: FAILED - {str(e)}")
        
    # 3. Test Redis Connectivity
    print("\n📡 Testing Redis (Queue) Connection...")
    try:
        import redis
        r = redis.from_url(settings.REDIS_URL, socket_connect_timeout=5)
        r.ping()
        print("✅ Redis: CONNECTED")
    except Exception as e:
        print(f"❌ Redis: FAILED - {str(e)}")
        
    # 4. Test Azure App Insights Initialization
    print("\n📈 Testing Azure App Insights Integration...")
    if settings.APPLICATIONINSIGHTS_CONNECTION_STRING:
        print("✅ App Insights String: PRESENT")
        logger.info("DIAGNOSTIC: App Insights Test Pulse", status="verifying")
    else:
        print("⚠️ App Insights String: ABSENT (Logs will only go to Log Stream)")

    print("\n" + "="*50)
    if not missing:
        print("🎉 ENVIRONMENT HEALTH: GREEN")
    else:
        print(f"🛑 ENVIRONMENT HEALTH: RED (Missing {len(missing)} variables)")
    print("="*50 + "\n")

if __name__ == "__main__":
    verify_environment()
