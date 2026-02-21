/**
 * Optional interface that a ResourceInstance can implement to expose
 * stable, boot-time key/value pairs into the shared CEL context.
 *
 * Values are captured once after init() completes and cached for the
 * lifetime of the initialization phase. Do not return request-specific
 * or mutable data — this is AOT (Ahead-of-Time) static context only.
 */
export interface ContextProvider {
  provideContext(): Record<string, unknown>;
}

/**
 * Duck-type guard: returns true when `instance` has a callable `provideContext` method.
 * The kernel uses this to detect providers without coupling to any concrete class,
 * keeping the Core 100% generic.
 */
export function isContextProvider(instance: unknown): instance is ContextProvider {
  return (
    typeof instance === 'object' &&
    instance !== null &&
    'provideContext' in instance &&
    typeof (instance as Record<string, unknown>)['provideContext'] === 'function'
  );
}
