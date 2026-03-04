import type { ResourceContext, ResourceInstance } from "@telorun/sdk";

interface HttpClientManifest {
  baseUrl?: string;
  headers?: Record<string, string>;
  timeout?: number;
  followRedirects?: boolean;
}

class HttpClientResource implements ResourceInstance {
  readonly metadata: { name: string; module: string; [key: string]: any };

  constructor(private readonly manifest: any) {
    this.metadata = manifest.metadata ?? {};
  }

  snapshot() {
    return {
      baseUrl: this.manifest.baseUrl ?? "",
      headers: this.manifest.headers ?? {},
      timeout: this.manifest.timeout ?? 10000,
      followRedirects: this.manifest.followRedirects ?? true,
    };
  }
}

export function register(): void {}

export async function create(
  resource: HttpClientManifest,
  _ctx: ResourceContext,
): Promise<HttpClientResource> {
  return new HttpClientResource(resource);
}
