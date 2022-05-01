
import { parse } from 'graphql';
import type { DocumentNode } from 'graphql';


export class ParseCache {
  #cache = new Map<string, DocumentNode>();
  #usedQueryLength = 0;
  #queryLength;

  constructor(queryLength = 100_000) {
    this.#queryLength = queryLength;
  }

  parse = (query: string) => {
    const normalizedQuery = query.replace(/[\s,]+/g, ' ').trim();
    const cachedNode = this.#cache.get(normalizedQuery);
    if (cachedNode) {
      return cachedNode;
    }

    const node = parse(normalizedQuery, { noLocation: true });
    this.#cache.set(normalizedQuery, node);

    // Simple clear cache logic. Don't allow more than this many bytes in total string content.
    this.#usedQueryLength += normalizedQuery.length;
    while (this.#usedQueryLength > this.#queryLength) {
      const key = this.#cache.keys().next();
      this.#usedQueryLength -= key.value.length;
      this.#cache.delete(key.value);
    }

    return node;
  };

  clear() {
    this.#usedQueryLength = 0;
    this.#cache.clear();
  }

  get count() {
    return this.#cache.size;
  }

  get use() {
    return this.#usedQueryLength / this.#queryLength;
  }
}
