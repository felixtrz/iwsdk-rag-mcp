#!/bin/bash
#
# IWSDK RAG Complete Ingestion Pipeline
#
# This script runs the complete ingestion process:
# 1. Sets up Python virtual environment (if needed)
# 2. Installs Python dependencies (if needed)
# 3. Clones immersive-web-sdk from GitHub
# 4. Installs dependencies (pnpm install)
# 5. Builds the SDK (npm run build:tgz)
# 6. Ingests IWSDK source code
# 7. Ingests dependencies (Three.js, WebXR types)
# 8. Exports to JSON for MCP server
# 9. Runs health check
# 10. Cleans up temporary files
#
# This script is fully self-contained and handles all setup automatically.
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
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Get script directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
INGEST_DIR="$SCRIPT_DIR/ingest"

echo ""
echo "=================================="
echo "🚀 IWSDK RAG Ingestion Pipeline"
echo "=================================="
echo ""

# Check for Python 3
if ! command -v python3 &> /dev/null; then
    echo -e "${RED}❌ Python 3 not found${NC}"
    echo "   Please install Python 3.8 or higher"
    exit 1
fi

PYTHON_VERSION=$(python3 --version | awk '{print $2}')
echo -e "${BLUE}🐍 Python version: $PYTHON_VERSION${NC}"
echo ""

# Setup virtual environment if it doesn't exist
if [ ! -d "$INGEST_DIR/venv" ]; then
    echo -e "${YELLOW}📦 Virtual environment not found, creating...${NC}"
    cd "$INGEST_DIR"
    python3 -m venv venv
    echo -e "${GREEN}✅ Virtual environment created${NC}"
    echo ""
fi

# Setup Python paths
VENV_PYTHON="$INGEST_DIR/venv/bin/python3"
echo "🔧 Using virtual environment: $VENV_PYTHON"
echo ""

# Check if dependencies are installed
REQUIREMENTS_FILE="$INGEST_DIR/requirements.txt"
if [ -f "$REQUIREMENTS_FILE" ]; then
    echo "📦 Checking Python dependencies..."

    # Simple check: if chromadb is not installed, install all requirements
    if ! "$VENV_PYTHON" -c "import chromadb" 2>/dev/null; then
        echo -e "${YELLOW}📥 Installing Python dependencies...${NC}"
        "$VENV_PYTHON" -m pip install --upgrade pip --quiet
        "$VENV_PYTHON" -m pip install -r "$REQUIREMENTS_FILE"
        echo -e "${GREEN}✅ Python dependencies installed${NC}"
    else
        echo -e "${GREEN}✅ Python dependencies already installed${NC}"
    fi
    echo ""
fi

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
"$VENV_PYTHON" scripts/ingest_all.py "$@"

INGEST_EXIT_CODE=$?

if [ $INGEST_EXIT_CODE -eq 0 ]; then
    echo ""
    echo -e "${GREEN}✅ Ingestion pipeline completed successfully!${NC}"
    echo ""
    echo "Next steps:"
    echo "  1. npm run build"
    echo "  2. Restart Claude Desktop/Code"
    echo ""
else
    echo ""
    echo -e "${RED}❌ Ingestion pipeline failed${NC}"
    exit 1
fi
