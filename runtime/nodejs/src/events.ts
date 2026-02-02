type EventHandler = (payload?: any) => void | Promise<void>;

export class EventBus {
  private handlers: Map<string, Set<EventHandler>> = new Map();

  on(event: string, handler: EventHandler): void {
    const set = this.handlers.get(event) || new Set();
    set.add(handler);
    this.handlers.set(event, set);
  }

  once(event: string, handler: EventHandler): void {
    const wrapper: EventHandler = async (payload?: any) => {
      this.off(event, wrapper);
      await handler(payload);
    };
    this.on(event, wrapper);
  }

  off(event: string, handler: EventHandler): void {
    const set = this.handlers.get(event);
    if (!set) {
      return;
    }
    set.delete(handler);
    if (set.size === 0) {
      this.handlers.delete(event);
    }
  }

  async emit(event: string, payload?: any): Promise<void> {
    if (process.env.DIGLY_VERBOSE === '1') {
      console.log('DEBUG: Event emitted:', event, JSON.stringify(payload));
    }
    const set = this.handlers.get(event);
    if (!set || set.size === 0) {
      return;
    }
    await Promise.all(Array.from(set).map((handler) => handler(payload)));
  }

  hasHandlers(event: string): boolean {
    const set = this.handlers.get(event);
    return !!set && set.size > 0;
  }
}
