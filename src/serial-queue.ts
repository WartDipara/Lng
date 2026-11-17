/** A failed operation rejects its caller without poisoning subsequent work. */
export class SerialQueue {
  private pending: Promise<unknown> = Promise.resolve();

  run<T>(action: () => Promise<T>): Promise<T> {
    const task = this.pending.then(action);
    this.pending = task.catch(() => {});
    return task;
  }
}

export const yieldToUI = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
