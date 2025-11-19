/**
 * Quick test to verify MCP server search functionality
 */

import { SearchService } from '../dist/search.js';

async function testSearch() {
  console.log('🧪 Testing MCP Server Search\n');

  // Initialize search service
  console.log('📚 Initializing search service...');
  const searchService = new SearchService();
  await searchService.initialize();
  console.log('✅ Search service initialized\n');

  // Debug: Check first chunk structure
  const debugResult = await searchService.search('test', { limit: 1 });
  if (debugResult.length > 0) {
    console.log('🔍 Debug - First chunk structure:');
    console.log('   chunk.id:', debugResult[0].chunk.id);
    console.log('   chunk.metadata:', JSON.stringify(debugResult[0].chunk.metadata, null, 2).substring(0, 200));
    console.log();
  }

  // Test queries
  const testQueries = [
    'How to initialize XR session?',
    'ECS component creation',
    'WebXR input handling',
    'Three.js camera setup'
  ];

  for (const query of testQueries) {
    console.log(`🔍 Query: "${query}"`);
    const results = await searchService.search(query, { limit: 3 });

    console.log(`   Found ${results.length} results:`);
    results.forEach((result, i) => {
      const chunk = result.chunk;
      console.log(`   ${i + 1}. ${chunk.metadata.name} (${chunk.metadata.chunk_type}) - score: ${result.score.toFixed(3)}`);
      console.log(`      ${chunk.metadata.file_path}:${chunk.metadata.start_line}`);
    });
    console.log();
  }

  console.log('✅ All tests passed!\n');
}

testSearch().catch(console.error);
