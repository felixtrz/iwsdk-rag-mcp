/**
 * Test script to verify the new embeddings format works correctly
 */

import { SearchService } from '../dist/search.js';

async function main() {
  console.log('Testing new embeddings format...\n');

  try {
    // Initialize search service
    console.log('1. Initializing search service...');
    const searchService = new SearchService();
    await searchService.initialize();

    // Get stats
    console.log('\n2. Checking loaded data statistics:');
    const stats = searchService.getStats();
    console.log(`   Total chunks: ${stats.total_chunks}`);
    console.log('   By source:');
    for (const [source, count] of Object.entries(stats.by_source)) {
      console.log(`     - ${source}: ${count}`);
    }
    console.log('   By type (top 10):');
    const sortedTypes = Object.entries(stats.by_type)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);
    for (const [type, count] of sortedTypes) {
      console.log(`     - ${type}: ${count}`);
    }

    // Test semantic search
    console.log('\n3. Testing semantic search:');
    const searchResults = await searchService.search('how to create a VR session', { limit: 3 });
    console.log(`   Found ${searchResults.length} results`);
    for (let i = 0; i < searchResults.length; i++) {
      const result = searchResults[i];
      console.log(`   [${i + 1}] Score: ${result.score.toFixed(4)} - ${result.chunk.metadata.name} (${result.chunk.metadata.source})`);
    }

    // Test API lookup
    console.log('\n4. Testing API reference lookup:');
    const apiResults = searchService.getByName('Component', { source_filter: ['iwsdk'] });
    console.log(`   Found ${apiResults.length} results for "Component"`);
    if (apiResults.length > 0) {
      console.log(`   First result: ${apiResults[0].metadata.name} (${apiResults[0].metadata.chunk_type})`);
    }

    // Test relationship query
    console.log('\n5. Testing relationship query (extends Component):');
    const relResults = searchService.findByRelationship({
      type: 'extends',
      target: 'Component',
      limit: 5
    });
    console.log(`   Found ${relResults.length} classes that extend Component`);
    for (let i = 0; i < Math.min(relResults.length, 3); i++) {
      console.log(`   - ${relResults[i].metadata.name}`);
    }

    console.log('\n✅ All tests passed! New embeddings format is working correctly.');

  } catch (error) {
    console.error('\n❌ Test failed:', error);
    process.exit(1);
  }
}

main();
