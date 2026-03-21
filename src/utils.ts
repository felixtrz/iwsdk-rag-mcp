/**
 * Shared utility functions
 */

/**
 * Safely convert a field to an array.
 * Handles both arrays and single strings (not splitting strings into chars).
 */
export function toArray(value: unknown): string[] {
  if (!value) {return [];}
  if (Array.isArray(value)) {return value;}
  if (typeof value === 'string') {return [value];}
  return [];
}
