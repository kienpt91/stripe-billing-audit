/** A hard cap on the number of HTTP requests one run may make, retries included. */
export class RequestBudget {
  private readonly max: number;
  private taken = 0;

  constructor(max: number) {
    this.max = Math.max(0, Math.floor(max));
  }

  /** Takes one request from the budget; false when it is spent. */
  tryTake(): boolean {
    if (this.taken >= this.max) return false;
    this.taken += 1;
    return true;
  }

  get used(): number {
    return this.taken;
  }

  get remaining(): number {
    return this.max - this.taken;
  }
}
