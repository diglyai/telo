export interface Invocable<TInput = Record<string, any>, TOutput = any> {
  invoke(inputs: TInput): Promise<TOutput>;
}
