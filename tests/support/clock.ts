/** Управляемые часы для сервисов: время двигают явно, а не ждут. */
export class FakeClock {
  constructor(private current: Date) {}

  readonly now = (): Date => new Date(this.current);

  set(value: Date): void {
    this.current = new Date(value);
  }

  advance(milliseconds: number): void {
    this.current = new Date(this.current.getTime() + milliseconds);
  }
}
