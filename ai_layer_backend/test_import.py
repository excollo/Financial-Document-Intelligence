
import sys
import os

# Add current directory to sys.path
sys.path.append(os.getcwd())

print(f"Current working directory: {os.getcwd()}")
print(f"sys.path: {sys.path}")

try:
    from app.services.vector_store import vector_store_service
    print("Successfully imported vector_store_service")
except Exception as e:
    print(f"Failed to import: {e}")
