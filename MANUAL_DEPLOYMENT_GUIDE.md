# 📄 Manual Deployment Guide: Financial Document Intelligence

This guide explains how to update your application in Azure by manually building and pushing Docker images from your Mac. Use this method since you currently lack "Owner" permissions for full GitHub automation.

---

## 🏗️ 1. Prepare for Deployment
Before starting, ensure you have the **Azure CLI** and **Docker Desktop** running on your Mac.

### Login to Azure & Registry
You must do this once per session:
```bash
az login
az acr login --name drhpacr
```
> [!IMPORTANT]
> Always use **lowercase** letters for `drhpacr` in your terminal commands to avoid authentication errors.

---

## 🚀 2. Building & Pushing Updates
When you make a change to your code, follow these steps to upload it to Azure.

### For Node Backend
```bash
cd node_backend
# 1. Build for Azure's platform (AMD64)
docker build --platform linux/amd64 -t drhpacr.azurecr.io/node-backend:latest --target node-backend .

# 2. Push to Registry
docker push drhpacr.azurecr.io/node-backend:latest
```

### For AI Layer Backend
```bash
cd ai_layer_backend
# 1. Build for Azure's platform (AMD64)
docker build --platform linux/amd64 -t drhpacr.azurecr.io/ai-backend:latest --target ai-backend .

# 2. Push to Registry
docker push drhpacr.azurecr.io/ai-backend:latest
```

---

## 🔄 3. Updating the Azure Container App
Once the push is finished, Azure has the image but hasn't "installed" it yet. To update the running app:

1.  Open the **Azure Portal**.
2.  Go to your **Container App** (e.g., `aca-node-backend`).
3.  On the left menu, click **"Revision Management"**.
4.  Click **"+ Create new revision"**.
5.  Ensure the latest image version is selected and click **Create**.
6.  Azure will automatically start the new version and shut down the old one (Zero Downtime).

---

## 🛠️ 4. Handling Environment Variables (.env)
Since Docker images do **not** contain your secrets (like Mongo passwords), you must set them in the Azure Portal:

1.  Open your **Container App**.
2.  Go to **"Configuration"** → **"Secrets"**.
3.  Add your secrets there (e.g., `MONGODB_URI`).
4.  Then go to **"Containers"** → **"Environment Variables"** and link them to those secrets.

---

## 💡 Pro-Tip: Automation (Future)
To make this happen automatically when you "Git Push", you will need your Admin to run:
`az ad sp create-for-rbac --name "github-deployer" --role contributor --scopes /subscriptions/<ID> --sdk-auth`

Once you have that JSON block, we can set up the GitHub Actions repo to do all these steps for you!
