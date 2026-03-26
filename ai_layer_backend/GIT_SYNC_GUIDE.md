# Git Sync & Integration Guide 📂

This guide explains how to commit the current changes and integrate them into your development branch.

## 1. Check Current Status
First, see all the files you've modified and created:
```bash
git status
```

## 2. Create a New Branch (Recommended)
It's best to keep the main code clean while you test the layers.
```bash
git checkout -b feature/data-ingestion-layer
```

## 3. Stage and Commit Changes
Select only the relevant files from the `ai-python-platform/` directory.

```bash
# Add the core platform files
git add ai-python-platform/

# If you modified the .gitignore or requirements.txt outside that folder, add them too
git add .gitignore requirements.txt

# Commit with a meaningful message
git commit -m "feat: complete data ingestion layer (sync extraction & chunking)"
```

## 4. Push to Remote
Send your branch to the central repository (GitHub/GitLab).
```bash
git push origin feature/data-ingestion-layer
```

## 5. Merging into Main/Development
Once the testing of this layer is fully approved:

1. **Go to your Git provider UI** (GitHub/render/etc).
2. Create a **Pull Request (PR)** from `feature/data-ingestion-layer` to `main`.
3. Review the diff to ensure no `.env` files or secrets are being committed.
4. **Merge** the PR.

### ⚠️ IMPORTANT: Security Warning
Ensure your `.env` file is **NEVER** committed. Check your `.gitignore` to be safe:

```bash
# Check if .env is ignored
git check-ignore -v .env
```
*(If it returns a path, it is properly ignored and safe).*

## 6. Syncing other developers
Tell other developers on the team to run:
```bash
git pull origin main
pip install -r requirements.txt
```
