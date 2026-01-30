#!/bin/bash
#
# Deploy a Daedalus Mini App to MinIO and register in catalog
#
# Usage: deploy.sh <app-id> <name> <icon> <description> [--no-build]
#
# Example:
#   ./deploy.sh habit-tracker "Habit Tracker" "✅" "Track daily habits with streaks"
#

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# MinIO credentials
MINIO_ENDPOINT="https://minio.wheelbase.io"
MINIO_ACCESS_KEY="wheelbase-admin"
MINIO_SECRET_KEY="uDtIQzNGC8bIdTOhiTHy60an"
MINIO_BUCKET="daedalus"

# Parse arguments
APP_ID="$1"
APP_NAME="$2"
APP_ICON="$3"
APP_DESC="$4"
NO_BUILD=""

if [ "$5" = "--no-build" ]; then
  NO_BUILD="true"
fi

# Validate arguments
if [ -z "$APP_ID" ] || [ -z "$APP_NAME" ] || [ -z "$APP_ICON" ] || [ -z "$APP_DESC" ]; then
  echo -e "${RED}Error: Missing arguments${NC}"
  echo "Usage: deploy.sh <app-id> <name> <icon> <description> [--no-build]"
  echo ""
  echo "Example:"
  echo "  ./deploy.sh habit-tracker \"Habit Tracker\" \"✅\" \"Track daily habits\""
  exit 1
fi

# Validate app-id format (lowercase, alphanumeric, hyphens)
if ! [[ "$APP_ID" =~ ^[a-z0-9-]+$ ]]; then
  echo -e "${RED}Error: app-id must be lowercase alphanumeric with hyphens only${NC}"
  exit 1
fi

echo -e "${GREEN}🚀 Deploying ${APP_NAME} (${APP_ID})${NC}"
echo ""

# Check if we're in an app directory
if [ ! -f "package.json" ]; then
  echo -e "${RED}Error: No package.json found. Run this from your app directory.${NC}"
  exit 1
fi

# Build the app
if [ -z "$NO_BUILD" ]; then
  echo -e "${YELLOW}📦 Building app...${NC}"
  pnpm build
  echo -e "${GREEN}✓ Build complete${NC}"
else
  echo -e "${YELLOW}⏭️  Skipping build (--no-build)${NC}"
fi

# Check build output
if [ ! -f "dist/index.html" ]; then
  echo -e "${RED}Error: dist/index.html not found. Build may have failed.${NC}"
  exit 1
fi

BUILD_SIZE=$(du -h dist/index.html | cut -f1)
echo -e "   Build size: ${BUILD_SIZE}"
echo ""

# Configure mc if needed
echo -e "${YELLOW}☁️  Uploading to MinIO...${NC}"

# Check if mc is available
if ! command -v mc &> /dev/null; then
  # Try to use mc from /tmp or install
  if [ -f "/tmp/mc" ]; then
    MC="/tmp/mc"
  else
    echo "Installing MinIO client..."
    curl -sL https://dl.min.io/client/mc/release/linux-amd64/mc -o /tmp/mc
    chmod +x /tmp/mc
    MC="/tmp/mc"
  fi
else
  MC="mc"
fi

# Configure MinIO alias
$MC alias set daedalus-deploy "$MINIO_ENDPOINT" "$MINIO_ACCESS_KEY" "$MINIO_SECRET_KEY" --quiet 2>/dev/null || true

# Upload the HTML file
APP_PATH="apps/${APP_ID}/index.html"
$MC cp dist/index.html "daedalus-deploy/${MINIO_BUCKET}/${APP_PATH}" --quiet

echo -e "${GREEN}✓ Uploaded to ${MINIO_ENDPOINT}/${MINIO_BUCKET}/${APP_PATH}${NC}"
echo ""

# Update catalog
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
echo -e "${YELLOW}📝 Updating catalog...${NC}"

python3 "${SCRIPT_DIR}/update-catalog.py" add \
  --id "$APP_ID" \
  --name "$APP_NAME" \
  --icon "$APP_ICON" \
  --description "$APP_DESC" \
  --path "/${APP_PATH}"

echo -e "${GREEN}✓ Catalog updated${NC}"
echo ""

# Done!
echo -e "${GREEN}═══════════════════════════════════════════════════${NC}"
echo -e "${GREEN}✅ Deployment complete!${NC}"
echo ""
echo -e "   App ID:    ${APP_ID}"
echo -e "   Name:      ${APP_NAME}"
echo -e "   Icon:      ${APP_ICON}"
echo -e "   URL:       ${MINIO_ENDPOINT}/${MINIO_BUCKET}/${APP_PATH}"
echo ""
echo -e "   Open in Telegram: https://t.me/ai_icarus_bot"
echo -e "${GREEN}═══════════════════════════════════════════════════${NC}"
