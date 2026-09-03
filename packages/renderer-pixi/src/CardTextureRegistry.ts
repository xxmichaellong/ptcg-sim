export interface TextureAssetAdapter<Texture> {
  readonly placeholder: Texture;
  readonly load: (url: string) => Promise<Texture>;
  readonly unload: (url: string) => Promise<void>;
}

interface TextureEntry<Texture> {
  readonly url: string;
  readonly promise: Promise<Texture>;
  references: number;
}

interface CardBinding<Texture> {
  readonly url: string;
  readonly entry: TextureEntry<Texture>;
  readonly token: number;
  readonly onReady: (texture: Texture) => void;
  readonly onError: (error: unknown) => void;
}

/**
 * Deduplicates board texture loads and ensures late completions cannot bind to
 * a recycled card view. Zero-reference entries are unloaded instead of being
 * retained across concealment/role/room transitions.
 */
export class CardTextureRegistry<Texture> {
  private readonly assets: TextureAssetAdapter<Texture>;
  private readonly entries = new Map<string, TextureEntry<Texture>>();
  private readonly bindings = new Map<string, CardBinding<Texture>>();
  private nextToken = 0;
  private disposed = false;

  constructor(assets: TextureAssetAdapter<Texture>) {
    this.assets = assets;
  }

  get placeholder(): Texture {
    return this.assets.placeholder;
  }

  bind(
    cardId: string,
    url: string,
    onReady: (texture: Texture) => void,
    onError: (error: unknown) => void
  ): void {
    if (this.disposed) throw new Error('Texture registry is disposed');
    const current = this.bindings.get(cardId);
    if (current?.url === url) return;
    this.release(cardId);

    let entry = this.entries.get(url);
    if (!entry) {
      entry = { url, references: 0, promise: this.assets.load(url) };
      this.entries.set(url, entry);
    }
    entry.references += 1;
    const binding: CardBinding<Texture> = {
      url,
      entry,
      token: ++this.nextToken,
      onReady,
      onError,
    };
    this.bindings.set(cardId, binding);
    void entry.promise.then(
      (texture) => {
        if (this.isCurrent(cardId, binding)) binding.onReady(texture);
      },
      (error: unknown) => {
        if (this.isCurrent(cardId, binding)) binding.onError(error);
      }
    );
  }

  release(cardId: string): void {
    const binding = this.bindings.get(cardId);
    if (!binding) return;
    this.bindings.delete(cardId);
    binding.entry.references -= 1;
    if (binding.entry.references !== 0) return;
    void binding.entry.promise
      .then(
        async () => {
          if (
            binding.entry.references !== 0 ||
            this.entries.get(binding.url) !== binding.entry ||
            [...this.bindings.values()].some(
              (candidate) => candidate.entry === binding.entry
            )
          ) {
            return;
          }
          this.entries.delete(binding.url);
          await this.assets.unload(binding.url);
        },
        () => {
          if (
            binding.entry.references === 0 &&
            this.entries.get(binding.url) === binding.entry
          ) {
            this.entries.delete(binding.url);
          }
        }
      )
      .catch(() => undefined);
  }

  destroy(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const cardId of [...this.bindings.keys()]) this.release(cardId);
    this.bindings.clear();
  }

  private isCurrent(cardId: string, binding: CardBinding<Texture>): boolean {
    const current = this.bindings.get(cardId);
    return (
      !this.disposed &&
      current?.token === binding.token &&
      current.entry === binding.entry
    );
  }
}
