import * as yaml from "js-yaml";
import type { ManifestAdapter, ManifestSourceData } from "./manifest-adapter.js";

const REGISTRY_BASE = "https://registry.telo.run";

export class RegistryAdapter implements ManifestAdapter {
  supports(pathOrUrl: string): boolean {
    // Matches "owner/module@version" — has @ and /, but not an http/https URL or local path
    return (
      !pathOrUrl.startsWith("http://") &&
      !pathOrUrl.startsWith("https://") &&
      !pathOrUrl.startsWith("/") &&
      !pathOrUrl.startsWith(".") &&
      pathOrUrl.includes("@") &&
      pathOrUrl.includes("/")
    );
  }

  async read(moduleRef: string): Promise<ManifestSourceData> {
    return (await this.readAll(moduleRef))[0];
  }

  async readAll(moduleRef: string): Promise<ManifestSourceData[]> {
    const url = this.toRegistryUrl(moduleRef);
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(
        `Failed to fetch manifest ${moduleRef}: ${response.status} ${response.statusText}`,
      );
    }
    return [
      {
        documents: yaml.loadAll(await response.text()),
        source: url,
        baseDir: process.cwd(),
        uriBase: url.replace("/module.yaml", ""),
      },
    ];
  }

  resolveRelative(base: string, relative: string): string {
    const baseUrl = this.supports(base)
      ? this.toRegistryUrl(base).replace("/module.yaml", "")
      : base;
    const baseWithSlash = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
    return new URL(relative, baseWithSlash).href;
  }

  private toRegistryUrl(moduleRef: string): string {
    const atIdx = moduleRef.lastIndexOf("@");
    const path = moduleRef.slice(0, atIdx); // "example/module"
    const version = moduleRef.slice(atIdx + 1); // "1.2.3" or "v1.2.3"
    const versionSegment = version.startsWith("v") ? version.substring(1) : version;
    return `${REGISTRY_BASE}/${path}/${versionSegment}/module.yaml`;
  }
}
