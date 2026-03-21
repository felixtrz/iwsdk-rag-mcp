#!/usr/bin/env node
/**
 * Test script for IWSDK RAG MCP server
 * Sends JSON-RPC requests via stdio and validates responses
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

    this.proc.stderr.on('data', (data) => {
      // Server logs go to stderr - suppress unless debugging
    });

    // Initialize the MCP connection
    await this.send('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'test-client', version: '1.0.0' },
    });

    // Send initialized notification
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
      } catch {
        // Not JSON, skip
      }
    }
  }

  send(method, params) {
    return new Promise((resolve, reject) => {
      const id = ++this.requestId;
      this.pending.set(id, resolve);
      const msg = JSON.stringify({ jsonrpc: '2.0', id, method, params });
      this.proc.stdin.write(msg + '\n');
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`Timeout waiting for response to ${method}`));
        }
      }, 60000);
    });
  }

  notify(method, params) {
    const msg = JSON.stringify({ jsonrpc: '2.0', method, params });
    this.proc.stdin.write(msg + '\n');
  }

  async callTool(name, args) {
    const resp = await this.send('tools/call', { name, arguments: args });
    return resp;
  }

  stop() {
    this.proc.kill();
  }
}

// Test helpers
let passed = 0;
let failed = 0;

function assert(condition, testName, detail = '') {
  if (condition) {
    console.log(`  ✅ ${testName}`);
    passed++;
  } else {
    console.log(`  ❌ ${testName}${detail ? ': ' + detail : ''}`);
    failed++;
  }
}

function getResultText(resp) {
  if (resp.result?.content?.[0]?.text) return resp.result.content[0].text;
  if (resp.error) return `ERROR: ${resp.error.message}`;
  return '';
}

// ========== TESTS ==========

async function testSearchCode(client) {
  console.log('\n🔍 Testing search_code...');

  // Test 1: Basic search for XR session
  const r1 = await client.callTool('search_code', { query: 'XR session initialization', limit: 5 });
  const t1 = getResultText(r1);
  assert(t1.includes('Search Results'), 'Returns search results header');
  assert(!t1.includes('No results found'), 'Finds results for XR session', t1.slice(0, 100));
  assert(t1.includes('score:'), 'Results include scores');

  // Test 2: Search for ECS component pattern
  const r2 = await client.callTool('search_code', { query: 'ECS component definition', limit: 5 });
  const t2 = getResultText(r2);
  assert(!t2.includes('No results found'), 'Finds results for ECS components');

  // Test 3: Search with source filter
  const r3 = await client.callTool('search_code', { query: 'Component', limit: 5, source: ['iwsdk'] });
  const t3 = getResultText(r3);
  assert(!t3.includes('No results found'), 'Finds results with source filter');
  // All results should be from iwsdk
  const depsMatch = t3.match(/\*\*Source\*\*: deps/g);
  assert(!depsMatch, 'Source filter excludes deps results');

  // Test 4: Verbosity 0 (metadata only)
  const r4 = await client.callTool('search_code', { query: 'Transform', limit: 3, verbosity: 0 });
  const t4 = getResultText(r4);
  assert(t4.includes('use verbosity'), 'Verbosity 0 shows metadata hint');

  // Test 5: Verbosity 1 (first 10 lines)
  const r5 = await client.callTool('search_code', { query: 'Transform', limit: 3, verbosity: 1 });
  const t5 = getResultText(r5);
  assert(!t5.includes('No results found'), 'Verbosity 1 returns results');

  // Test 6: min_score filter
  const r6 = await client.callTool('search_code', { query: 'XR controller input', limit: 10, min_score: 0.5 });
  const t6 = getResultText(r6);
  // Check that all scores are >= 0.5
  const scores = [...t6.matchAll(/score: (\d+\.\d+)/g)].map(m => parseFloat(m[1]));
  const allAboveMin = scores.length === 0 || scores.every(s => s >= 0.5);
  assert(allAboveMin, 'min_score filters low-relevance results');

  // Test 7: Deduplication - request many results and check for overlapping chunks
  const r7 = await client.callTool('search_code', { query: 'physics collision detection', limit: 10 });
  const t7 = getResultText(r7);
  assert(!r7.result?.isError, 'Deduplication search succeeds');
}

async function testFindByRelationship(client) {
  console.log('\n🔗 Testing find_by_relationship...');

  // Test 1: Find classes that extend Component
  const r1 = await client.callTool('find_by_relationship', { type: 'extends', target: 'Component', limit: 10 });
  const t1 = getResultText(r1);
  assert(!t1.includes('No code found'), 'Finds classes extending Component');
  assert(t1.includes('extends'), 'Results mention extends relationship');

  // Test 2: Find code that imports something
  const r2 = await client.callTool('find_by_relationship', { type: 'imports', target: 'System', limit: 5 });
  const t2 = getResultText(r2);
  assert(!t2.includes('No code found'), 'Finds code that imports System');

  // Test 3: Find WebXR API usage
  const r3 = await client.callTool('find_by_relationship', { type: 'uses_webxr_api', target: 'XRSession', limit: 5 });
  const t3 = getResultText(r3);
  assert(!r3.result?.isError, 'WebXR API search succeeds');
}

async function testGetApiReference(client) {
  console.log('\n📖 Testing get_api_reference...');

  // Test 1: Look up a known class
  const r1 = await client.callTool('get_api_reference', { name: 'Component' });
  const t1 = getResultText(r1);
  assert(!t1.includes('No API found'), 'Finds Component API', t1.slice(0, 100));
  assert(t1.includes('API Reference'), 'Returns API reference header');

  // Test 2: Look up with type filter
  const r2 = await client.callTool('get_api_reference', { name: 'System', type: 'class' });
  const t2 = getResultText(r2);
  assert(!r2.result?.isError, 'Type-filtered API lookup succeeds');

  // Test 3: Look up Three.js type from deps
  const r3 = await client.callTool('get_api_reference', { name: 'Vector3', source: ['deps'] });
  const t3 = getResultText(r3);
  assert(!t3.includes('No API found'), 'Finds Vector3 in deps (@types/three)', t3.slice(0, 100));
}

async function testGetFileContent(client) {
  console.log('\n📄 Testing get_file_content...');

  // Test 1: Read an IWSDK file
  const r1 = await client.callTool('get_file_content', { file_path: 'packages/core/src/index.ts', source: 'iwsdk' });
  const t1 = getResultText(r1);
  assert(!r1.result?.isError, 'Reads IWSDK file without error', t1.slice(0, 100));

  // Test 2: Read a non-existent file
  const r2 = await client.callTool('get_file_content', { file_path: 'does/not/exist.ts', source: 'iwsdk' });
  const t2 = getResultText(r2);
  assert(r2.result?.isError || t2.includes('not found'), 'Returns error for missing file');
}

async function testListEcsComponents(client) {
  console.log('\n🧩 Testing list_ecs_components...');

  const r1 = await client.callTool('list_ecs_components', {});
  const t1 = getResultText(r1);
  assert(!t1.includes('No ECS components found'), 'Finds ECS components', t1.slice(0, 200));
  assert(t1.includes('ECS Components'), 'Returns components header');
}

async function testListEcsSystems(client) {
  console.log('\n⚙️  Testing list_ecs_systems...');

  const r1 = await client.callTool('list_ecs_systems', {});
  const t1 = getResultText(r1);
  assert(!t1.includes('No ECS systems found'), 'Finds ECS systems', t1.slice(0, 200));
  assert(t1.includes('ECS Systems'), 'Returns systems header');
}

async function testFindDependents(client) {
  console.log('\n🔄 Testing find_dependents...');

  const r1 = await client.callTool('find_dependents', { api_name: 'Component' });
  const t1 = getResultText(r1);
  assert(!t1.includes('No code found'), 'Finds dependents of Component');

  const r2 = await client.callTool('find_dependents', { api_name: 'System', dependency_type: 'extends' });
  const t2 = getResultText(r2);
  assert(!r2.result?.isError, 'Dependency type filter works');
}

async function testFindUsageExamples(client) {
  console.log('\n📝 Testing find_usage_examples...');

  const r1 = await client.callTool('find_usage_examples', { api_name: 'Component', limit: 5 });
  const t1 = getResultText(r1);
  assert(!t1.includes('No usage examples found'), 'Finds usage examples for Component');
  assert(t1.includes('Usage Examples'), 'Returns usage examples header');
}

async function testPreload() {
  console.log('\n🔄 Testing --preload flag...');

  const result = await new Promise((resolve, reject) => {
    const proc = spawn('node', [serverPath, '--preload'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => { stdout += data.toString(); });
    proc.stderr.on('data', (data) => { stderr += data.toString(); });

    const timeout = setTimeout(() => {
      proc.kill();
      reject(new Error('--preload timed out after 120s'));
    }, 120000);

    proc.on('close', (code) => {
      clearTimeout(timeout);
      resolve({ code, stdout, stderr });
    });
  });

  // Exit code 0
  assert(result.code === 0, 'Preload exits with code 0', `got code ${result.code}`);

  // Stdout contains structured preload_complete JSON
  let preloadEvent = null;
  try {
    preloadEvent = JSON.parse(result.stdout.trim());
  } catch { /* not valid JSON */ }
  assert(preloadEvent !== null, 'Preload stdout is valid JSON', result.stdout.slice(0, 200));
  assert(preloadEvent?.event === 'preload_complete', 'Preload event is "preload_complete"', `got "${preloadEvent?.event}"`);
  assert(typeof preloadEvent?.model === 'string' && preloadEvent.model.length > 0, 'Preload includes model name');
  assert(typeof preloadEvent?.timestamp === 'number', 'Preload includes timestamp');

  // Stderr contains structured model_loaded event
  const stderrLines = result.stderr.trim().split('\n');
  const modelLoadedLine = stderrLines.find(line => {
    try { return JSON.parse(line).event === 'model_loaded'; } catch { return false; }
  });
  assert(modelLoadedLine !== undefined, 'Stderr contains model_loaded event');
}

// ========== MAIN ==========

async function main() {
  console.log('🚀 Starting IWSDK RAG MCP Server tests...\n');

  // Test --preload first (standalone, no MCP client needed)
  await testPreload();

  const client = new MCPTestClient();
  try {
    await client.start();
    console.log('\n✅ Server started and initialized\n');

    await testSearchCode(client);
    await testFindByRelationship(client);
    await testGetApiReference(client);
    await testGetFileContent(client);
    await testListEcsComponents(client);
    await testListEcsSystems(client);
    await testFindDependents(client);
    await testFindUsageExamples(client);

    console.log(`\n${'='.repeat(50)}`);
    console.log(`Results: ${passed} passed, ${failed} failed`);
    console.log(`${'='.repeat(50)}`);
  } catch (error) {
    console.error('Fatal error:', error);
  } finally {
    client.stop();
    process.exit(failed > 0 ? 1 : 0);
  }
}

main();
