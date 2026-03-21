#!/usr/bin/env node
/**
 * Relevance quality test - checks that search results are actually relevant
 */

import { spawn } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverPath = resolve(__dirname, '..', 'dist', 'index.js');

class MCPTestClient {
  constructor() {
    this.requestId = 0;
    this.pending = new Map();
    this.buffer = '';
  }

  async start() {
    this.proc = spawn('node', [serverPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.proc.stdout.on('data', (data) => {
      this.buffer += data.toString();
      this.processBuffer();
    });
    this.proc.stderr.on('data', () => {});
    await this.send('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'test-client', version: '1.0.0' },
    });
    this.notify('notifications/initialized', {});
  }

  processBuffer() {
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const msg = JSON.parse(trimmed);
        if (msg.id !== undefined && this.pending.has(msg.id)) {
          this.pending.get(msg.id)(msg);
          this.pending.delete(msg.id);
        }
      } catch {}
    }
  }

  send(method, params) {
    return new Promise((resolve, reject) => {
      const id = ++this.requestId;
      this.pending.set(id, resolve);
      this.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
      setTimeout(() => {
        if (this.pending.has(id)) { this.pending.delete(id); reject(new Error(`Timeout: ${method}`)); }
      }, 60000);
    });
  }

  notify(method, params) {
    this.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
  }

  async callTool(name, args) {
    return await this.send('tools/call', { name, arguments: args });
  }

  stop() { this.proc.kill(); }
}

function getResultText(resp) {
  return resp.result?.content?.[0]?.text || '';
}

function extractResults(text) {
  const results = [];
  const blocks = text.split('---');
  for (const block of blocks) {
    const nameMatch = block.match(/## (.+?)(?:\s*\(score: (\d+\.\d+)\))?$/m);
    const sourceMatch = block.match(/\*\*Source\*\*: (.+)/);
    const fileMatch = block.match(/\*\*File\*\*: (.+)/);
    const typeMatch = block.match(/\*\*Type\*\*: (.+)/);
    if (nameMatch) {
      results.push({
        name: nameMatch[1].trim(),
        score: nameMatch[2] ? parseFloat(nameMatch[2]) : null,
        source: sourceMatch?.[1]?.trim(),
        file: fileMatch?.[1]?.trim(),
        type: typeMatch?.[1]?.trim(),
      });
    }
  }
  return results;
}

async function main() {
  console.log('🔬 IWSDK RAG Relevance Quality Tests\n');

  const client = new MCPTestClient();
  await client.start();
  console.log('✅ Server ready\n');

  const tests = [
    {
      name: 'XR session setup',
      tool: 'search_code',
      args: { query: 'how to create and start a WebXR session', limit: 5, verbosity: 0 },
      check: (results) => {
        const hasXR = results.some(r =>
          r.name.toLowerCase().includes('xr') ||
          r.name.toLowerCase().includes('session') ||
          r.file?.toLowerCase().includes('xr')
        );
        return { pass: hasXR, detail: `Top results: ${results.map(r => `${r.name} (${r.source})`).join(', ')}` };
      },
    },
    {
      name: 'Grab/interaction system',
      tool: 'search_code',
      args: { query: 'grab interaction hand tracking', limit: 5, verbosity: 0 },
      check: (results) => {
        const hasGrab = results.some(r =>
          r.name.toLowerCase().includes('grab') ||
          r.name.toLowerCase().includes('hand') ||
          r.name.toLowerCase().includes('interact')
        );
        return { pass: hasGrab, detail: `Top results: ${results.map(r => `${r.name} (${r.source})`).join(', ')}` };
      },
    },
    {
      name: 'Physics/collision',
      tool: 'search_code',
      args: { query: 'physics rigid body collision', limit: 5, verbosity: 0 },
      check: (results) => {
        const relevant = results.some(r =>
          r.name.toLowerCase().includes('physics') ||
          r.name.toLowerCase().includes('rigid') ||
          r.name.toLowerCase().includes('collid') ||
          r.name.toLowerCase().includes('havok')
        );
        return { pass: relevant, detail: `Top results: ${results.map(r => `${r.name} (${r.source})`).join(', ')}` };
      },
    },
    {
      name: 'Locomotion/teleport',
      tool: 'search_code',
      args: { query: 'locomotion teleport movement', limit: 5, verbosity: 0 },
      check: (results) => {
        const relevant = results.some(r =>
          r.name.toLowerCase().includes('locomot') ||
          r.name.toLowerCase().includes('teleport') ||
          r.name.toLowerCase().includes('move')
        );
        return { pass: relevant, detail: `Top results: ${results.map(r => `${r.name} (${r.source})`).join(', ')}` };
      },
    },
    {
      name: 'ECS component creation',
      tool: 'search_code',
      args: { query: 'how to define a custom ECS component', limit: 5, verbosity: 0 },
      check: (results) => {
        // Good results are actual component definitions (type=component) or Component class itself
        const relevant = results.some(r =>
          r.type === 'component' ||
          r.name.toLowerCase().includes('component')
        );
        return { pass: relevant, detail: `Top results: ${results.map(r => `${r.name} [${r.type}] (${r.source})`).join(', ')}` };
      },
    },
    {
      name: 'Three.js Vector3 in deps',
      tool: 'get_api_reference',
      args: { name: 'Vector3', source: ['deps'] },
      check: (results) => {
        const hasVector3 = results.some(r => r.name.includes('Vector3'));
        return { pass: hasVector3, detail: `Found ${results.length} results` };
      },
    },
    {
      name: 'Three.js Mesh in deps',
      tool: 'get_api_reference',
      args: { name: 'Mesh', source: ['deps'] },
      check: (results) => {
        const hasMesh = results.some(r => r.name.includes('Mesh'));
        return { pass: hasMesh, detail: `Found ${results.length} results` };
      },
    },
    {
      name: 'Audio system',
      tool: 'search_code',
      args: { query: 'spatial audio 3D sound', limit: 5, verbosity: 0 },
      check: (results) => {
        const relevant = results.some(r =>
          r.name.toLowerCase().includes('audio') ||
          r.name.toLowerCase().includes('sound') ||
          r.file?.toLowerCase().includes('audio')
        );
        return { pass: relevant, detail: `Top results: ${results.map(r => `${r.name} (${r.source})`).join(', ')}` };
      },
    },
    {
      name: 'IWSDK source dominance for SDK queries',
      tool: 'search_code',
      args: { query: 'IWSDK engine initialization', limit: 5, verbosity: 0 },
      check: (results) => {
        const iwsdkCount = results.filter(r => r.source === 'iwsdk').length;
        return { pass: iwsdkCount >= 3, detail: `${iwsdkCount}/5 results from iwsdk: ${results.map(r => `${r.name} (${r.source})`).join(', ')}` };
      },
    },
    {
      name: 'Score ordering',
      tool: 'search_code',
      args: { query: 'ray casting intersection', limit: 10, verbosity: 0 },
      check: (results) => {
        const scores = results.filter(r => r.score !== null).map(r => r.score);
        const sorted = scores.every((s, i) => i === 0 || s <= scores[i - 1]);
        return { pass: sorted, detail: `Scores: ${scores.map(s => s.toFixed(3)).join(', ')}` };
      },
    },
  ];

  let passed = 0;
  let failed = 0;

  for (const test of tests) {
    const resp = await client.callTool(test.tool, test.args);
    const text = getResultText(resp);
    const results = extractResults(text);
    const { pass, detail } = test.check(results);

    if (pass) {
      console.log(`  ✅ ${test.name}`);
      console.log(`     ${detail}`);
      passed++;
    } else {
      console.log(`  ❌ ${test.name}`);
      console.log(`     ${detail}`);
      failed++;
    }
    console.log('');
  }

  console.log(`${'='.repeat(60)}`);
  console.log(`Relevance: ${passed}/${passed + failed} tests passed`);
  console.log(`${'='.repeat(60)}`);

  client.stop();
  process.exit(failed > 0 ? 1 : 0);
}

main();
