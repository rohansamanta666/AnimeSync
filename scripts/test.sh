#!/usr/bin/env bash
set -e

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

echo "🧪 Running AnimeSync Verification Suites..."

# 1. Backend Pytest
echo "1. Running backend pytest suite..."
source .venv/bin/activate
PYTHONPATH=. pytest backend/tests -W ignore::DeprecationWarning

# 2. Frontend Unit Tests & Build Verification
echo "2. Running frontend unit tests..."
cd frontend
npm test
echo "3. Running frontend TypeScript & build check..."
npm run build
cd "$PROJECT_ROOT"

echo "✅ All AnimeSync test suites passed successfully!"

