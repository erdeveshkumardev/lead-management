#!/bin/bash
# ==============================================================================
# LeadCRM - 1-Click Build & Kubernetes Deployment Script for Hostinger VPS
# ==============================================================================
set -e

echo "=========================================="
echo "🚀 1. Building Docker Images..."
echo "=========================================="

# Build Backend Image
echo "📦 Building Backend..."
docker build -t leadcrm-backend:latest ./backend

# Build Frontend Image
echo "📦 Building Frontend..."
docker build -t leadcrm-frontend:latest ./frontend

echo "=========================================="
echo "🔄 2. Importing Images into Kubernetes..."
echo "=========================================="

# If using K3s (Default on Hostinger VPS):
if command -v k3s &> /dev/null; then
    echo "Saving and importing images directly into K3s runtime..."
    docker save leadcrm-backend:latest | sudo k3s ctr images import -
    docker save leadcrm-frontend:latest | sudo k3s ctr images import -
fi

echo "=========================================="
echo "☸️  3. Applying Kubernetes Manifests & Restarting Pods..."
echo "=========================================="

kubectl apply -k k8s/

# Force rollout restart so Pods terminate old containers and spin up with the new imported image!
echo "🔄 Triggering rollout restart for Frontend & Backend deployments..."
kubectl -n leadcrm rollout restart deployment/frontend-deployment
kubectl -n leadcrm rollout restart deployment/backend-deployment

echo "=========================================="
echo "⏳ 4. Waiting for Pods to be Ready..."
echo "=========================================="

kubectl -n leadcrm rollout status deployment/backend-deployment --timeout=120s
kubectl -n leadcrm rollout status deployment/frontend-deployment --timeout=120s

echo "=========================================="
echo "✅ 5. Deployment Completed Successfully!"
echo "=========================================="
kubectl -n leadcrm get pods -o wide
kubectl -n leadcrm get svc
kubectl -n leadcrm get ingress

echo ""
echo "🎉 Live URL: https://leadcrm.travistas.in"
