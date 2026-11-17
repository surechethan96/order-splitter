import {
  BadRequestException,
  Injectable,
  type ArgumentMetadata,
  type PipeTransform,
} from '@nestjs/common';

const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

// A real order is about 4 levels deep. Much deeper input would overflow the validator's stack and cause a 500.
export const MAX_DEPTH = 10;

// Runs before validation. class-transformer quietly drops unsafe keys, so the unknown-field check never sees them.
@Injectable()
export class RejectUnsafeInputPipe implements PipeTransform {
  transform(value: unknown, metadata: ArgumentMetadata): unknown {
    if (metadata.type !== 'body' && metadata.type !== 'query') return value;
    const problems = findInputProblems(value);
    if (problems.length > 0) throw new BadRequestException(problems);
    return value;
  }
}

// Lists unsafe keys and too-deep nesting. Uses a loop, not recursion, so a deep body cannot crash it.
export function findInputProblems(value: unknown): string[] {
  const problems: string[] = [];
  const queue: Array<{ node: unknown; path: string; depth: number }> = [
    { node: value, path: '', depth: 0 },
  ];
  for (let i = 0; i < queue.length; i++) {
    const { node, path, depth } = queue[i];
    if (node === null || typeof node !== 'object') continue;
    if (depth >= MAX_DEPTH) {
      problems.push(
        `request must not be nested more than ${MAX_DEPTH} levels deep`,
      );
      break;
    }
    for (const key of Object.keys(node)) {
      const childPath = path ? `${path}.${key}` : key;
      if (UNSAFE_KEYS.has(key)) {
        problems.push(`property ${childPath} should not exist`);
      } else {
        queue.push({
          node: (node as Record<string, unknown>)[key],
          path: childPath,
          depth: depth + 1,
        });
      }
    }
  }
  return problems;
}
