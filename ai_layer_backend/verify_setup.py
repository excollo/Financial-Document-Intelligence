#!/usr/bin/env python3
"""
Startup verification script.
Checks if all dependencies are properly configured.
"""
import sys
import importlib


def check_imports():
    """Check if all required packages can be imported."""
    required_packages = [
        'fastapi',
        'uvicorn',
        'celery',
        'redis',
        'pymongo',
        'motor',
        'structlog',
        'pydantic',
        'pydantic_settings',
        'dotenv',
        'requests',
        'numpy',
    ]
    
    missing = []
    for package in required_packages:
        try:
            importlib.import_module(package)
            print(f"✓ {package}")
        except ImportError:
            print(f"✗ {package}")
            missing.append(package)
    
    return missing


def check_structure():
    """Check if all required files and directories exist."""
    import os
    
    required_paths = [
        'app/__init__.py',
        'app/main.py',
        'app/core/config.py',
        'app/core/logging.py',
        'app/db/mongo.py',
        'app/api/jobs.py',
        'app/workers/celery_app.py',
        'app/workers/document_pipeline.py',
        'app/services/extraction.py',
        'app/services/chunking.py',
        'app/services/embedding.py',
        'requirements.txt',
        '.env.example',
        'docker/api.Dockerfile',
        'docker/worker.Dockerfile',
    ]
    
    missing = []
    for path in required_paths:
        if os.path.exists(path):
            print(f"✓ {path}")
        else:
            print(f"✗ {path}")
            missing.append(path)
    
    return missing


def main():
    """Run all checks."""
    print("=" * 60)
    print("AI Python Platform - Verification Script")
    print("=" * 60)
    
    print("\n📦 Checking Python packages...")
    print("-" * 60)
    missing_packages = check_imports()
    
    print("\n📁 Checking project structure...")
    print("-" * 60)
    missing_files = check_structure()
    
    print("\n" + "=" * 60)
    if not missing_packages and not missing_files:
        print("✅ All checks passed! Platform is ready to run.")
        print("\nNext steps:")
        print("  1. Copy .env.example to .env and configure")
        print("  2. Start Redis: redis-server")
        print("  3. Start MongoDB: mongod")
        print("  4. Start API: python -m app.main")
        print("  5. Start Worker: celery -A app.workers.celery_app worker --loglevel=info")
        return 0
    else:
        print("❌ Some checks failed!")
        if missing_packages:
            print(f"\nMissing packages: {', '.join(missing_packages)}")
            print("Run: pip install -r requirements.txt")
        if missing_files:
            print(f"\nMissing files: {', '.join(missing_files)}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
