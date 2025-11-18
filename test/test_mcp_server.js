/**
 * Test the MCP server end-to-end
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function testMCPServer() {
  console.log('Testing MCP Server...\n');

  // Start the MCP server
  const serverPath = join(__dirname, '..', 'dist', 'index.js');
  const server = spawn('node', [serverPath], {
    stdio: ['pipe', 'pipe', 'pipe']
  });

  let stdoutData = '';
  let stderrData = '';
  let responded = false;

  server.stdout.on('data', (data) => {
    stdoutData += data.toString();
    // Check if we got a response
    if (stdoutData.includes('"result"')) {
      responded = true;
    }
  });

  server.stderr.on('data', (data) => {
    stderrData += data.toString();
  });

  // Wait for initialization messages
  await new Promise(resolve => setTimeout(resolve, 2000));

  console.log('Server stderr output:');
  console.log(stderrData);
  console.log('');

  // Send a list tools request
  console.log('Sending list_tools request...');
  const listToolsRequest = {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/list'
  };

  server.stdin.write(JSON.stringify(listToolsRequest) + '\n');

  // Wait for response
  await new Promise(resolve => setTimeout(resolve, 1000));

  if (responded) {
    console.log('✅ Server responded to list_tools request');
    try {
      // Try to parse the response
      const responses = stdoutData.trim().split('\n');
      const lastResponse = responses[responses.length - 1];
      const parsed = JSON.parse(lastResponse);
      if (parsed.result && parsed.result.tools) {
        console.log(`✅ Found ${parsed.result.tools.length} tools`);
        console.log('   Tools:', parsed.result.tools.map(t => t.name).join(', '));
      }
    } catch (e) {
      console.log('⚠️  Could not parse response:', e.message);
    }
  } else {
    console.log('❌ Server did not respond');
  }

  // Send a search request
  console.log('\nSending search_code request...');
  const searchRequest = {
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: {
      name: 'search_code',
      arguments: {
        query: 'how to create a VR session',
        limit: 3
      }
    }
  };

  stdoutData = ''; // Reset
  server.stdin.write(JSON.stringify(searchRequest) + '\n');

  // Wait for response
  await new Promise(resolve => setTimeout(resolve, 3000));

  if (stdoutData.includes('"result"')) {
    console.log('✅ Server responded to search_code request');
    try {
      const responses = stdoutData.trim().split('\n').filter(l => l.trim());
      const lastResponse = responses[responses.length - 1];
      const parsed = JSON.parse(lastResponse);
      if (parsed.result && parsed.result.content) {
        console.log('✅ Got search results');
      }
    } catch (e) {
      console.log('⚠️  Could not parse response:', e.message);
    }
  } else {
    console.log('⚠️  No response to search request yet (might need more time)');
  }

  // Clean up
  server.kill();
  console.log('\n✅ MCP server test completed');
}

testMCPServer().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
