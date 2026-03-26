# CI/CD Setup Guide (Azure + GitHub Actions) 🚀

This guide explains how to set up the automated deployment for your `main`, `dev`, and `sandbox` branches.

## 1. Branch mapping
- **`main`** branch → **Production** Environment (`prod`)
- **`dev`** branch → **Development** Environment (`dev`)
- **`sandbox`** branch → **Sandbox** Environment (`sandbox`)

## 2. GitHub Secrets Configuration
To make the CI/CD work, go to **GitHub > Settings > Secrets and Variables > Actions** and add the following secrets:

| Secret Name | Description |
| :--- | :--- |
| `AZURE_CREDENTIALS` | JSON output from `az ad sp create-for-rbac` |
| `AZURE_CONTAINER_REGISTRY` | The name of your Azure Container Registry (ACR) |
| `AZURE_RESOURCE_GROUP` | The name of your Azure Resource Group |
| `AZURE_CONTAINER_APP_ENV` | The name of your Container Apps Environment |

## 3. How to create the Azure Credentials
Run this in your terminal to get the JSON for `AZURE_CREDENTIALS`:
```bash
az ad sp create-for-rbac --name "myApp" --role contributor \
    --scopes /subscriptions/{subscription-id}/resourceGroups/{resource-group} \
    --sdk-auth
```

## 4. Pipeline Steps
When you push code:
1. **Test Phase**: Runs `test_ingestion.py` to ensure core logic isn't broken.
2. **Build Phase**: Build Docker images for both API and Worker.
3. **Deploy Phase**: Deploys the containers to Azure Container Apps.

## 5. Deployment command (Manual)
If you want to deploy manually from your machine:
```bash
# Example for Sandbox
az containerapp up \
  --name ai-platform-api-sandbox \
  --source . \
  --resource-group <rg> \
  --environment <env>
```
