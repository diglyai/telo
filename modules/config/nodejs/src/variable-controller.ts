import type {
  ContextProvider,
  ResourceContext,
  ResourceInstance,
  RuntimeResource,
} from "@telorun/sdk";

/**
 * Shape of a Config.Variable manifest as resolved by the kernel.
 *
 * CEL context path after boot:
 *   Config.Variable.<name>.value
 *
 * Example manifest:
 *   kind: Config.Variable
 *   metadata:
 *     name: ApiBaseUrl
 *   source:
 *     env: API_BASE_URL
 *
 * Consumer usage:
 *   someField: "${{ Config.Variable.ApiBaseUrl.value }}"
 */
type ConfigVariableResource = RuntimeResource & {
  source: {
    env: string;
  };
  grants?: string[];
};

class ConfigVariable implements ResourceInstance, ContextProvider {
  private value: string | undefined;

  constructor(private readonly resource: ConfigVariableResource) {}

  async init(): Promise<void> {
    this.value = process.env[this.resource.source.env];
  }

  /**
   * Exposes { value } into the AOT CEL context under Config.Variable.<name>.
   * When the env var is absent the value is undefined, which is intentional
   * for optional variables — contrast with Config.Secret which throws.
   */
  provideContext(): Record<string, unknown> {
    return { value: this.value };
  }
}

export function create(
  resource: ConfigVariableResource,
  _ctx: ResourceContext,
): ResourceInstance {
  return new ConfigVariable(resource);
}
