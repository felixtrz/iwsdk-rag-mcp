/**
 * Test script to check if jina-embeddings-v2-base-code works with Transformers.js
 *
 * This will try different model names to see which one works:
 * 1. Xenova/jina-embeddings-v2-base-code (ONNX version if exists)
 * 2. jinaai/jina-embeddings-v2-base-code (official model)
 */

import { pipeline } from '@huggingface/transformers';

const testCode = `
function fibonacci(n) {
  if (n <= 1) return n;
  return fibonacci(n - 1) + fibonacci(n - 2);
}
`;

async function testModel(modelName) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Testing: ${modelName}`);
  console.log('='.repeat(60));

  try {
    console.log('Loading model...');
    const startTime = Date.now();

    const extractor = await pipeline('feature-extraction', modelName, {
      // Try different precision options
      // quantized: false  // Uncomment if needed
    });

    const loadTime = Date.now() - startTime;
    console.log(`✓ Model loaded successfully in ${loadTime}ms`);

    console.log('\nGenerating embedding for test code...');
    const embedStart = Date.now();

    const output = await extractor(testCode, {
      pooling: 'mean',
      normalize: true
    });

    const embedTime = Date.now() - embedStart;
    console.log(`✓ Embedding generated in ${embedTime}ms`);

    // Check output shape
    const embedding = Array.from(output.data);
    console.log(`✓ Embedding dimensions: ${embedding.length}`);
    console.log(`✓ First 5 values: [${embedding.slice(0, 5).map(v => v.toFixed(4)).join(', ')}]`);

    // Verify it's a valid embedding
    const magnitude = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
    console.log(`✓ Vector magnitude: ${magnitude.toFixed(4)} (should be ~1.0 if normalized)`);

    console.log(`\n✅ SUCCESS: ${modelName} works with Transformers.js!`);
    return true;

  } catch (error) {
    console.error(`\n❌ FAILED: ${modelName}`);
    console.error(`Error: ${error.message}`);

    // More detailed error info
    if (error.message.includes('not found') || error.message.includes('404')) {
      console.error('→ Model not found on Hugging Face (no ONNX weights available)');
    } else if (error.message.includes('ONNX')) {
      console.error('→ ONNX runtime error');
    } else {
      console.error('→ Stack trace:', error.stack);
    }

    return false;
  }
}

async function runTests() {
  console.log('Testing Jina Code Embedding Models with Transformers.js');
  console.log('Node version:', process.version);

  const modelsToTest = [
    'Xenova/jina-embeddings-v2-base-code',  // ONNX version (if exists)
    'jinaai/jina-embeddings-v2-base-code',  // Official model (might auto-convert)
  ];

  const results = {};

  for (const model of modelsToTest) {
    results[model] = await testModel(model);
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('SUMMARY');
  console.log('='.repeat(60));

  for (const [model, success] of Object.entries(results)) {
    console.log(`${success ? '✅' : '❌'} ${model}`);
  }

  const anySuccess = Object.values(results).some(v => v);
  if (anySuccess) {
    console.log('\n🎉 At least one model works! You can use it in your MCP server.');
  } else {
    console.log('\n⚠️  No Jina code models work with Transformers.js yet.');
    console.log('   Recommendation: Use Xenova/nomic-embed-text-v1 instead.');
  }
}

runTests().catch(console.error);
