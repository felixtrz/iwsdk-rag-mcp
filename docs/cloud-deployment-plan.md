# Cloud Deployment Plan: IWSDK RAG MCP Server on AWS

## Problem

The MCP server currently runs locally on users' machines. It requires downloading a ~420MB transformer model (`jinaai/jina-embeddings-v2-base-code`) on first run, which is a poor onboarding experience. Deploying the server in the cloud eliminates this download requirement entirely — users just point their MCP client at a URL.

## Architecture Overview

```
┌─────────────────────┐         HTTPS          ┌──────────────────────────────────┐
│   Claude Desktop /  │ ◄────────────────────►  │   EC2 t4g.small (ARM)            │
│   Claude Code       │    MCP over SSE         │                                  │
│   (MCP Client)      │                         │  ┌────────────────────────────┐  │
└─────────────────────┘                         │  │  Express + rate limiter    │  │
                                                │  │  ┌──────────────────────┐  │  │
                                                │  │  │  MCP Server (SSE)    │  │  │
                                                │  │  │  ┌────────────────┐  │  │  │
                                                │  │  │  │ Jina Embedding │  │  │  │
                                                │  │  │  │ Model (420MB)  │  │  │  │
                                                │  │  │  └────────────────┘  │  │  │
                                                │  │  │  ┌────────────────┐  │  │  │
                                                │  │  │  │ embeddings.json│  │  │  │
                                                │  │  │  │ (94MB)         │  │  │  │
                                                │  │  │  └────────────────┘  │  │  │
                                                │  │  └──────────────────────┘  │  │
                                                │  └────────────────────────────┘  │
                                                └──────────────────────────────────┘
```

**Transport change**: The server currently uses `StdioServerTransport` (local pipe). For cloud, we switch to `SSEServerTransport` (HTTP + Server-Sent Events), which the MCP SDK already provides at `@modelcontextprotocol/sdk/server/sse.js`.

## Cost Estimate

| Item | Monthly Cost |
|------|-------------|
| EC2 t4g.small (2 vCPU, 2GB RAM, ARM) | **$0** (free tier promo through Dec 2026), then $12.26/mo |
| EBS storage (20GB gp3) | ~$1.60 |
| Data transfer (< 1GB/mo at low volume) | ~$0 |
| **Total** | **~$1.60/mo** (during promo), **~$14/mo** after |

## Implementation Plan

### Phase 1: Add HTTP/SSE Transport

The MCP SDK already includes `SSEServerTransport`. We need to wrap it in an Express server with rate limiting.

**New file: `src/server-http.ts`**

This is the cloud entry point (separate from the existing `src/index.ts` which stays as the local stdio entry point). It:

1. Creates an Express app on a configurable port (default 3000)
2. Uses `SSEServerTransport` from the MCP SDK for the MCP protocol
3. Adds rate limiting middleware (e.g., `express-rate-limit`)
4. Adds a `/health` endpoint for monitoring
5. Reuses all existing services (`SearchService`, `FileService`, tools) unchanged

```
src/
  index.ts          ← existing stdio entry point (unchanged)
  server-http.ts    ← NEW cloud entry point (Express + SSE)
  embeddings.ts     ← unchanged
  search.ts         ← unchanged
  tools.ts          ← unchanged
  files.ts          ← unchanged
  types.ts          ← unchanged
```

**Key implementation details:**

- The `SSEServerTransport` is created per-connection (each client gets its own SSE stream)
- Express handles the HTTP layer: `GET /sse` for the event stream, `POST /messages` for client→server messages
- The MCP `Server` instance and its tool handlers are shared across connections
- The existing `SearchService` and `EmbeddingService` initialize once at startup and serve all connections

**New dependencies:**
- `express` — HTTP server
- `express-rate-limit` — rate limiting per IP
- `@types/express` (dev)

**Rate limiting strategy:**
- 20 requests/minute per IP (generous for interactive code search)
- 500 character max query length (code search queries are short)
- Both configurable via environment variables

### Phase 2: Dockerize

**New file: `Dockerfile`**

```dockerfile
FROM node:20-slim

WORKDIR /app

# Install pnpm
RUN npm install -g pnpm

# Copy package files and install dependencies
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod

# Copy built code and data
COPY dist/ dist/
COPY data/ data/

# The transformer model downloads on first run (~420MB)
# and caches in /root/.cache/huggingface/
# We can pre-warm this in the build step:
RUN node -e "
  import('@huggingface/transformers').then(async ({ pipeline, env }) => {
    env.allowLocalModels = false;
    console.log('Downloading model...');
    await pipeline('feature-extraction', 'jinaai/jina-embeddings-v2-base-code');
    console.log('Model cached.');
  });
" || echo "Model will download on first start"

EXPOSE 3000

# Use the HTTP entry point for cloud deployment
CMD ["node", "dist/server-http.js"]
```

**New file: `.dockerignore`**

```
node_modules
src
tools
dist-tools
test
*.ts
tsconfig*.json
.git
```

**Image size estimate**: ~800MB (node:20-slim ~200MB + model ~420MB + deps + data ~180MB). This is a one-time build artifact — users never see this.

### Phase 3: EC2 Deployment

**Instance**: `t4g.small` (2 vCPU ARM, 2GB RAM) — free through Dec 2026.

**Setup steps:**

1. Launch a t4g.small instance with Amazon Linux 2023 (ARM)
2. Open port 443 (HTTPS) in the security group
3. Install Docker on the instance
4. Build and run the container
5. Set up Caddy or nginx as a reverse proxy for automatic HTTPS (Let's Encrypt)
6. Point a domain/subdomain at the instance (e.g., `rag.iwsdk.dev`)

**Deployment script (run on EC2):**

```bash
# Install Docker
sudo yum install -y docker
sudo systemctl enable --now docker
sudo usermod -aG docker ec2-user

# Install Caddy (reverse proxy with auto-HTTPS)
sudo yum install -y caddy
```

**Caddyfile:**

```
rag.iwsdk.dev {
    reverse_proxy localhost:3000
}
```

**Run the container:**

```bash
docker build -t iwsdk-rag .
docker run -d \
  --name iwsdk-rag \
  --restart unless-stopped \
  -p 3000:3000 \
  -e RATE_LIMIT_RPM=20 \
  -e MAX_QUERY_LENGTH=500 \
  iwsdk-rag
```

### Phase 4: Client Configuration

Users configure their MCP client to connect to the remote server instead of running locally.

**Claude Desktop (`claude_desktop_config.json`):**

```json
{
  "mcpServers": {
    "iwsdk-rag": {
      "url": "https://rag.iwsdk.dev/sse"
    }
  }
}
```

**Claude Code (`.mcp.json`):**

```json
{
  "mcpServers": {
    "iwsdk-rag": {
      "type": "sse",
      "url": "https://rag.iwsdk.dev/sse"
    }
  }
}
```

No npm install, no model download. Just add the URL and go.

## Security Considerations

**What's exposed:** Only the MCP tool endpoints (search_code, find_by_relationship, etc.). Users can only query IWSDK code — they cannot access the embedding model directly, run arbitrary code, or use the server for anything other than IWSDK code search.

**Protections:**
- Rate limiting (20 req/min per IP) prevents abuse
- Query length cap (500 chars) prevents payload attacks
- HTTPS via Caddy/Let's Encrypt encrypts all traffic
- No authentication needed initially (the service is free and read-only)
- Security group allows only port 443 inbound

**If abuse becomes a problem later**, add API keys (free, but required) — this gives per-user rate limiting and the ability to revoke bad actors.

## Monitoring

- `/health` endpoint for uptime monitoring (UptimeRobot, etc.)
- CloudWatch basic metrics (CPU, memory, network) — free with EC2
- Docker logs: `docker logs iwsdk-rag`
- Set a CloudWatch alarm for CPU > 80% sustained

## Future Considerations

- **Auto-scaling**: If usage grows beyond what a single t4g.small can handle, move to Fargate with auto-scaling (~$14-30/mo base)
- **CDN/caching**: If many users send the same queries, add a response cache (in-memory LRU or Redis) to avoid redundant embedding computations
- **Multi-region**: Deploy to additional regions if latency matters for international users
- **Embedding API migration**: If the model becomes a maintenance burden, switch to an embedding API (OpenAI/Bedrock) — requires re-embedding the corpus but simplifies the infra dramatically (see cost analysis below)

### Embedding API Option (for later)

If you ever want to eliminate the model from the server entirely:

| Provider | Cost at 500 queries/day | Notes |
|----------|------------------------|-------|
| OpenAI text-embedding-3-small | $0.03/mo | Cheapest, requires re-embedding corpus |
| Amazon Bedrock Titan V2 | $0.15/mo | Native AWS, requires re-embedding corpus |
| Jina AI v3 | $0.07/mo | Same vendor as current model, easiest migration |

This would shrink the Docker image from ~800MB to ~300MB and reduce server memory from ~650MB to ~200MB, making Lambda viable ($0-1/mo).

## Task Checklist

- [ ] Create `src/server-http.ts` (Express + SSE transport + rate limiting)
- [ ] Add `express` and `express-rate-limit` dependencies
- [ ] Add build script for the HTTP entry point
- [ ] Test locally: MCP client → HTTP server → search works
- [ ] Create `Dockerfile` and `.dockerignore`
- [ ] Build Docker image, test locally with `docker run`
- [ ] Provision EC2 t4g.small instance
- [ ] Set up domain DNS (e.g., `rag.iwsdk.dev`)
- [ ] Install Docker + Caddy on EC2
- [ ] Deploy container, configure Caddy for HTTPS
- [ ] Test end-to-end: Claude Desktop → remote MCP server → search results
- [ ] Set up basic monitoring (health check, CloudWatch alarm)
- [ ] Update README with remote server usage instructions
