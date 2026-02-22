import type {
  ContextProvider,
  ResourceContext,
  ResourceInstance,
  RuntimeResource,
} from "@telorun/sdk";

/**
 * Shape of a Config.Secret manifest as resolved by the kernel.
 *
 * CEL context path after boot:
 *   Config.Secret.<name>.value
 *
 * Example manifest:
 *   kind: Config.Secret
 *   metadata:
 *     name: StripeKey
 *   source:
 *     env: STRIPE_SECRET_KEY
 *   grants:
 *     - Http.Api/PaymentApi
 *
 * Consumer usage:
 *   someField: "${{ Config.Secret.StripeKey.value }}"
 *
 * Unlike Config.Variable, a missing environment variable is a hard boot-time
 * error — secrets are required by definition.
 */
type ConfigSecretResource = RuntimeResource & {
  source: {
    env: string;
  };
  grants?: string[];
};

class ConfigSecret implements ResourceInstance, ContextProvider {
  private value!: string;

  constructor(private readonly resource: ConfigSecretResource) {}

  async init(): Promise<void> {
    const raw = process.env[this.resource.source.env];

    if (raw === undefined) {
      throw new Error(
        `Config.Secret "${this.resource.metadata.name}": ` +
          `required environment variable "${this.resource.source.env}" is not set. ` +
          `Set it before starting the runtime.`,
      );
    }

    this.value = raw;
  }

  /**
   * Exposes { value } into the AOT CEL context under Config.Secret.<name>.
   * Only called after init() succeeds, so this.value is always a non-empty string.
   */
  provideContext(): Record<string, unknown> {
    return { value: this.value };
  }
}

export function create(
  resource: ConfigSecretResource,
  _ctx: ResourceContext,
): ResourceInstance {
  return new ConfigSecret(resource);
}
