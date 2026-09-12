import { throwIfCatalogAborted } from './tcgdex-catalog-http.js';

export const mapWithConcurrency = async <Input, Output>(
  inputs: readonly Input[],
  concurrency: number,
  signal: AbortSignal | undefined,
  map: (input: Input, index: number) => Promise<Output>
): Promise<Output[]> => {
  const results: Array<{ readonly value: Output } | undefined> = new Array(
    inputs.length
  );
  let nextIndex = 0;
  const worker = async (): Promise<void> => {
    while (nextIndex < inputs.length) {
      throwIfCatalogAborted(signal);
      const index = nextIndex;
      nextIndex += 1;
      const input = inputs[index];
      if (input === undefined) continue;
      results[index] = { value: await map(input, index) };
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(concurrency, inputs.length) }, async () =>
      worker()
    )
  );
  return results.map((result) => {
    if (!result)
      throw new Error('Catalog concurrency result was not assigned.');
    return result.value;
  });
};

export class BoundedStringCache {
  readonly #entries = new Map<string, string>();
  readonly #maximumEntries: number;

  constructor(maximumEntries: number) {
    this.#maximumEntries = maximumEntries;
  }

  has(key: string): boolean {
    return this.#entries.has(key);
  }

  get(key: string): string | undefined {
    const value = this.#entries.get(key);
    if (value === undefined) return undefined;
    this.#entries.delete(key);
    this.#entries.set(key, value);
    return value;
  }

  set(key: string, value: string): void {
    this.#entries.delete(key);
    this.#entries.set(key, value);
    if (this.#entries.size <= this.#maximumEntries) return;
    const oldestKey = this.#entries.keys().next().value;
    if (oldestKey !== undefined) this.#entries.delete(oldestKey);
  }

  clear(): void {
    this.#entries.clear();
  }
}
