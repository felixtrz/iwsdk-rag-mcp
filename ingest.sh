#!/bin/bash
#
# IWSDK RAG Complete Ingestion Pipeline
#
# This script runs the complete ingestion process:
# 1. Activates Python virtual environment
# 2. Clones immersive-web-sdk from GitHub
# 3. Installs dependencies (pnpm install)
# 4. Builds the SDK (npm run build:tgz)
# 5. Ingests IWSDK source code
# 6. Ingests dependencies (Three.js, WebXR types)
# 7. Exports to JSON for MCP server
# 8. Runs health check
# 9. Cleans up temporary files
#
# Usage:
#   ./ingest.sh              # Full pipeline
#   ./ingest.sh --keep-repo  # Keep cloned repo for inspection
#

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Get script directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
INGEST_DIR="$SCRIPT_DIR/ingest"

echo ""
echo "=================================="
echo "🚀 IWSDK RAG Ingestion Pipeline"
echo "=================================="
echo ""

# Check if virtual environment exists
if [ ! -d "$INGEST_DIR/venv" ]; then
    echo -e "${RED}❌ Virtual environment not found${NC}"
    echo "   Run: cd ingest && ./setup.sh"
    exit 1
fi

# Activate virtual environment
echo "🔧 Activating virtual environment..."
source "$INGEST_DIR/venv/bin/activate"

# Check for required commands
check_command() {
    if ! command -v $1 &> /dev/null; then
        echo -e "${RED}❌ $1 not found${NC}"
        echo "   Please install $1 and try again"
        exit 1
    fi
}

echo "🔍 Checking dependencies..."
check_command git
check_command node
check_command npm

# Check for pnpm (optional, will fall back to npm)
if ! command -v pnpm &> /dev/null; then
    echo -e "${YELLOW}⚠️  pnpm not found, will use npm instead${NC}"
fi

echo ""

# Run Python ingestion script
echo "▶️  Starting ingestion pipeline..."
echo ""

cd "$INGEST_DIR"
python scripts/ingest_all.py "$@"

INGEST_EXIT_CODE=$?

# Deactivate virtual environment
deactivate

if [ $INGEST_EXIT_CODE -eq 0 ]; then
    echo ""
    echo -e "${GREEN}✅ Ingestion pipeline completed successfully!${NC}"
    echo ""
    echo "Next steps:"
    echo "  1. cd mcp && npm run build"
    echo "  2. Restart Claude Desktop"
    echo ""
else
    echo ""
    echo -e "${RED}❌ Ingestion pipeline failed${NC}"
    exit 1
fi
