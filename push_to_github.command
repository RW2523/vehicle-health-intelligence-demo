#!/bin/bash
# Creates a PUBLIC GitHub repo "vehicle-health-intelligence-demo" from this folder and pushes it.
# Runs with YOUR own git / gh credentials. Output is logged to push_log.txt.
cd "$(dirname "$0")"
exec > >(tee push_log.txt) 2>&1
REPO=vehicle-health-intelligence-demo
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
echo "== $(date) =="
# unpack an app update if one was dropped into .incoming/ (see README), then commit everything
if [ -f .incoming/vehiclesense_app_update.tgz ]; then
  echo "Unpacking .incoming/vehiclesense_app_update.tgz ..."
  tar xzf .incoming/vehiclesense_app_update.tgz && mv .incoming/vehiclesense_app_update.tgz ".incoming/applied-$(date +%Y%m%d-%H%M%S).tgz"
fi
rm -f .git/index.lock 2>/dev/null
git add -A
if ! git diff --cached --quiet; then
  git commit -m "VehicleSense AI demo app: end-to-end pipeline, 7 web apps, E2E tests, Docker stack for DGX Spark" \
    -m "Backend (FastAPI + live models), Next.js apps, Playwright tests, docker-compose (TimescaleDB, Mosquitto, Ollama), Makefile and runbook."
fi
git status -s | head -5; git log --oneline | head -3
if ! command -v gh >/dev/null; then
  echo "gh CLI not found - installing with Homebrew..."
  if command -v brew >/dev/null; then brew install gh; else echo "NO_BREW: install GitHub CLI from https://cli.github.com then double-click this file again"; read -p "Press Enter to close"; exit 1; fi
fi
if ! gh auth status >/dev/null 2>&1; then
  echo "Please log in to GitHub (a browser window will open)..."
  gh auth login --hostname github.com --git-protocol https --web
fi
gh auth status
USER=$(gh api user -q .login); echo "GitHub user: $USER"
git config http.postBuffer 524288000
if gh repo view "$USER/$REPO" >/dev/null 2>&1; then
  git remote remove origin 2>/dev/null; git remote add origin "https://github.com/$USER/$REPO.git"
  git push -u origin main
else
  gh repo create "$REPO" --public --description "AI-assisted vehicle inspection demo data & pipeline (concept, DGX Spark)" --source=. --remote=origin --push
fi
echo "RESULT: https://github.com/$USER/$REPO"
gh repo view "$USER/$REPO" --json visibility,url -q '.url + " " + .visibility'
read -p "Done - press Enter to close"
