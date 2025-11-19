/**
 * File service for reading source files
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export class FileService {
  private sourcesDir: string;

  constructor() {
    this.sourcesDir = join(__dirname, '..', 'data', 'sources');
  }

  /**
   * Find a file by searching across all source directories
   */
  private findFile(relativePath: string, source: string): string | null {
    // Handle different path formats
    const searchPaths: string[] = [];

    // Strip 'src/' prefix if present
    const pathWithoutSrc = relativePath.startsWith('src/')
      ? relativePath.substring(4)
      : relativePath;

    if (source === 'iwsdk') {
      // New structure: data/sources/iwsdk/packages/{package}/src/...
      // Chunk paths are: packages/{package}/src/...
      // So just join directly
      const iwsdkDir = join(this.sourcesDir, 'iwsdk');
      searchPaths.push(join(iwsdkDir, relativePath));
    } else if (source === 'elics') {
      searchPaths.push(join(this.sourcesDir, 'elics', 'src', pathWithoutSrc));
    } else if (source === 'deps') {
      // For deps, the path might be absolute or relative
      if (relativePath.startsWith('/')) {
        // Absolute path - extract package name and relative path
        // Example: /path/to/node_modules/.pnpm/@types+three@0.177.0/node_modules/@types/three/index.d.ts
        // -> deps/three/index.d.ts

        if (relativePath.includes('@types/three')) {
          const match = relativePath.match(/@types\/three\/(.+)$/);
          if (match) {
            searchPaths.push(join(this.sourcesDir, 'deps', 'three', match[1]));
          }
        } else if (relativePath.includes('@types/webxr')) {
          const match = relativePath.match(/@types\/webxr\/(.+)$/);
          if (match) {
            searchPaths.push(join(this.sourcesDir, 'deps', 'webxr', match[1]));
          }
        }
      } else {
        // Relative path - search in both three and webxr
        searchPaths.push(join(this.sourcesDir, 'deps', 'three', relativePath));
        searchPaths.push(join(this.sourcesDir, 'deps', 'webxr', relativePath));
      }
    }

    // Find the first existing file
    for (const path of searchPaths) {
      if (existsSync(path)) {
        return path;
      }
    }

    return null;
  }

  /**
   * Read a file with optional line range
   */
  readFile(relativePath: string, source: string, options?: {
    startLine?: number;
    endLine?: number;
  }): string | null {
    const filePath = this.findFile(relativePath, source);
    if (!filePath) {
      return null;
    }

    try {
      const content = readFileSync(filePath, 'utf-8');

      if (options?.startLine !== undefined || options?.endLine !== undefined) {
        const lines = content.split('\n');
        const start = (options.startLine ?? 1) - 1;  // Convert to 0-indexed
        const end = options.endLine ?? lines.length;
        return lines.slice(start, end).join('\n');
      }

      return content;
    } catch (error) {
      console.error(`Error reading file ${filePath}:`, error);
      return null;
    }
  }

  /**
   * Check if a file exists
   */
  fileExists(relativePath: string, source: string): boolean {
    return this.findFile(relativePath, source) !== null;
  }
}
