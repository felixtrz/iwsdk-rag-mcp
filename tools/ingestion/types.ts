/**
 * Type definitions for code ingestion
 */

export interface TypeScriptChunk {
  // Core properties
  content: string;
  chunk_type: 'function' | 'class' | 'interface' | 'type' | 'enum' | 'method' | 'const' | 'variable' | 'component' | 'system';
  name: string;
  start_line: number;
  end_line: number;
  file_path: string;
  language: 'typescript' | 'javascript';

  // TypeScript-specific
  module_path?: string;  // npm package name
  class_name?: string;   // Parent class name (for methods)
  imports: string[];
  exports: string[];
  type_parameters: string[];
  decorators: string[];

  // Relationships
  calls: string[];
  extends: string[];
  implements: string[];
  uses_types: string[];

  // WebXR/ECS patterns
  ecs_component: boolean;
  ecs_system: boolean;
  webxr_api_usage: string[];
  three_js_usage: string[];

  // Semantic labels
  semantic_labels: string[];

  // Source metadata (added during export)
  source?: 'iwsdk' | 'elics' | 'deps';
}
