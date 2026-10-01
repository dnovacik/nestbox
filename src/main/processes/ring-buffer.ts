/** Fixed-capacity buffer that keeps the newest items. Items carry increasing `seq` numbers. */
export class RingBuffer<T extends { seq: number }> {
  private items: (T | undefined)[];
  private start = 0;
  private count = 0;

  constructor(private readonly capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1) throw new RangeError('capacity must be a positive integer');
    this.items = new Array<T | undefined>(capacity);
  }

  get size(): number {
    return this.count;
  }

  push(item: T): void {
    this.items[(this.start + this.count) % this.capacity] = item;
    if (this.count < this.capacity) this.count++;
    else this.start = (this.start + 1) % this.capacity;
  }

  toArray(): T[] {
    const out: T[] = [];
    for (let i = 0; i < this.count; i++) {
      const item = this.items[(this.start + i) % this.capacity];
      if (item) out.push(item);
    }
    return out;
  }

  /** Items with seq greater than `seq`, oldest first. */
  after(seq: number): T[] {
    const all = this.toArray();
    let i = all.length;
    while (i > 0 && (all[i - 1]?.seq ?? Number.NEGATIVE_INFINITY) > seq) i--;
    return all.slice(i);
  }

  clear(): void {
    this.items = new Array<T | undefined>(this.capacity);
    this.start = 0;
    this.count = 0;
  }
}
