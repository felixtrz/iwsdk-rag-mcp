/**
 * Compare embedding models for code search
 *
 * Tests:
 * 1. jinaai/jina-embeddings-v2-base-code (code-specialized)
 * 2. Xenova/nomic-embed-text-v1 (general-purpose, strong)
 * 3. Xenova/all-mpnet-base-v2 (current baseline)
 */

import { pipeline } from '@huggingface/transformers';

// Test cases: code snippets and queries
const testCases = {
  // Code snippets to index
  codeSnippets: [
    {
      id: 'xr-session',
      code: `class XRSession extends EventTarget {
  constructor() {
    super();
    this.renderState = new XRRenderState();
  }

  requestAnimationFrame(callback) {
    return this.id = requestAnimationFrame(() => {
      callback(performance.now(), new XRFrame(this));
    });
  }
}`,
      description: 'XR session class with animation frame'
    },
    {
      id: 'component-system',
      code: `export class Component {
  constructor(entity) {
    this.entity = entity;
    this.enabled = true;
  }

  update(deltaTime) {
    // Override in subclasses
  }

  onEnable() {}
  onDisable() {}
}`,
      description: 'ECS component base class'
    },
    {
      id: 'vector-math',
      code: `export function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function normalize(v) {
  const len = Math.sqrt(dot(v, v));
  return [v[0] / len, v[1] / len, v[2] / len];
}`,
      description: 'Vector math utilities'
    },
    {
      id: 'http-request',
      code: `async function fetchUserData(userId) {
  const response = await fetch(\`/api/users/\${userId}\`);
  if (!response.ok) {
    throw new Error(\`HTTP error! status: \${response.status}\`);
  }
  return await response.json();
}`,
      description: 'HTTP API request function'
    }
  ],

  // Search queries
  queries: [
    {
      text: 'how to create VR animation loop',
      expectedBest: 'xr-session',
      description: 'XR-specific query'
    },
    {
      text: 'entity component system base class',
      expectedBest: 'component-system',
      description: 'Architecture pattern query'
    },
    {
      text: 'vector dot product and normalization',
      expectedBest: 'vector-math',
      description: 'Math function query'
    },
    {
      text: 'fetch data from REST API endpoint',
      expectedBest: 'http-request',
      description: 'General web dev query'
    }
  ]
};

function cosineSimilarity(a, b) {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

async function testModel(modelName, modelLabel) {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`Testing: ${modelLabel}`);
  console.log(`Model: ${modelName}`);
  console.log('='.repeat(70));

  try {
    // Load model
    console.log('Loading model...');
    const startLoad = Date.now();
    const extractor = await pipeline('feature-extraction', modelName);
    const loadTime = Date.now() - startLoad;
    console.log(`✓ Loaded in ${loadTime}ms`);

    // Embed code snippets
    console.log('\nEmbedding code snippets...');
    const codeEmbeddings = [];
    let totalEmbedTime = 0;

    for (const snippet of testCases.codeSnippets) {
      const start = Date.now();
      const output = await extractor(snippet.code, { pooling: 'mean', normalize: true });
      const embedTime = Date.now() - start;
      totalEmbedTime += embedTime;

      codeEmbeddings.push({
        id: snippet.id,
        embedding: Array.from(output.data),
        description: snippet.description
      });
    }

    const avgEmbedTime = totalEmbedTime / testCases.codeSnippets.length;
    console.log(`✓ ${testCases.codeSnippets.length} snippets embedded (avg: ${avgEmbedTime.toFixed(1)}ms each)`);

    // Test queries
    console.log('\nTesting search queries...');
    const results = {
      correct: 0,
      total: testCases.queries.length,
      details: []
    };

    for (const query of testCases.queries) {
      const queryOutput = await extractor(query.text, { pooling: 'mean', normalize: true });
      const queryEmbedding = Array.from(queryOutput.data);

      // Find best match
      const similarities = codeEmbeddings.map(code => ({
        id: code.id,
        description: code.description,
        similarity: cosineSimilarity(queryEmbedding, code.embedding)
      }));

      similarities.sort((a, b) => b.similarity - a.similarity);
      const bestMatch = similarities[0];
      const isCorrect = bestMatch.id === query.expectedBest;

      results.details.push({
        query: query.text,
        expected: query.expectedBest,
        got: bestMatch.id,
        correct: isCorrect,
        similarity: bestMatch.similarity,
        top3: similarities.slice(0, 3)
      });

      if (isCorrect) results.correct++;

      const icon = isCorrect ? '✓' : '✗';
      console.log(`  ${icon} "${query.description}"`);
      console.log(`    Best: ${bestMatch.description} (${bestMatch.similarity.toFixed(4)})`);
    }

    const accuracy = (results.correct / results.total * 100).toFixed(1);
    console.log(`\nAccuracy: ${results.correct}/${results.total} (${accuracy}%)`);

    // Get embedding dimensions
    const dimensions = codeEmbeddings[0].embedding.length;

    return {
      success: true,
      modelName,
      modelLabel,
      loadTime,
      avgEmbedTime,
      accuracy: parseFloat(accuracy),
      dimensions,
      results
    };

  } catch (error) {
    console.error(`❌ Failed: ${error.message}`);
    return {
      success: false,
      modelName,
      modelLabel,
      error: error.message
    };
  }
}

async function runComparison() {
  console.log('Code Embedding Model Comparison');
  console.log('================================\n');

  const models = [
    { name: 'Xenova/all-mpnet-base-v2', label: 'all-mpnet-base-v2 (current)' },
    { name: 'Xenova/nomic-embed-text-v1', label: 'nomic-embed-text-v1 (general)' },
    { name: 'jinaai/jina-embeddings-v2-base-code', label: 'jina-code (specialized)' }
  ];

  const testResults = [];

  for (const model of models) {
    const result = await testModel(model.name, model.label);
    testResults.push(result);

    // Small delay between models
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  // Final comparison
  console.log('\n' + '='.repeat(70));
  console.log('COMPARISON SUMMARY');
  console.log('='.repeat(70));

  console.log('\n📊 Performance Metrics:\n');
  console.log('Model                          Load Time    Embed Time   Accuracy   Dimensions');
  console.log('-'.repeat(80));

  for (const result of testResults) {
    if (result.success) {
      const label = result.modelLabel.padEnd(30);
      const load = `${result.loadTime}ms`.padEnd(12);
      const embed = `${result.avgEmbedTime.toFixed(1)}ms`.padEnd(12);
      const accuracy = `${result.accuracy}%`.padEnd(10);
      const dims = result.dimensions;
      console.log(`${label} ${load} ${embed} ${accuracy} ${dims}`);
    } else {
      console.log(`${result.modelLabel.padEnd(30)} ❌ Failed: ${result.error}`);
    }
  }

  // Find best performer
  const successful = testResults.filter(r => r.success);
  if (successful.length > 0) {
    const bestAccuracy = successful.reduce((best, curr) =>
      curr.accuracy > best.accuracy ? curr : best
    );
    const fastest = successful.reduce((best, curr) =>
      curr.avgEmbedTime < best.avgEmbedTime ? curr : best
    );

    console.log('\n🏆 Winners:\n');
    console.log(`  Best Accuracy: ${bestAccuracy.modelLabel} (${bestAccuracy.accuracy}%)`);
    console.log(`  Fastest Embedding: ${fastest.modelLabel} (${fastest.avgEmbedTime.toFixed(1)}ms)`);

    console.log('\n💡 Recommendation:\n');
    if (bestAccuracy.modelName === fastest.modelName) {
      console.log(`  → Use ${bestAccuracy.modelLabel}`);
      console.log(`    (Best accuracy AND fastest)`);
    } else {
      console.log(`  → For code search: ${bestAccuracy.modelLabel}`);
      console.log(`    (${bestAccuracy.accuracy}% accuracy)`);
      console.log(`  → For speed: ${fastest.modelLabel}`);
      console.log(`    (${fastest.avgEmbedTime.toFixed(1)}ms per embedding)`);
    }
  }
}

runComparison().catch(console.error);
