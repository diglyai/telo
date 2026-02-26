import * as yaml from "js-yaml";
import type { ManifestAdapter, ManifestSourceData } from "./manifest-adapter.js";

export class HttpAdapter implements ManifestAdapter {
  supports(pathOrUrl: string): boolean {
    return pathOrUrl.startsWith("http://") || pathOrUrl.startsWith("https://");
  }

  async read(url: string): Promise<ManifestSourceData> {
    return (await this.readAll(url))[0];
  }

  async readAll(url: string): Promise<ManifestSourceData[]> {
    const fetchUrl = url.includes(".yaml") ? url : url + "/module.yaml";
    const response = await fetch(fetchUrl);
    if (!response.ok) {
      throw new Error(
        `Failed to fetch manifest from ${fetchUrl}: ${response.status} ${response.statusText}`,
      );
    }
    return [
      {
        documents: yaml.loadAll(await response.text()),
        source: fetchUrl,
        baseDir: process.cwd(),
        uriBase: url,
      },
    ];
  }

  resolveRelative(base: string, relative: string): string {
    const baseWithSlash = base.endsWith("/") ? base : `${base}/`;
    return new URL(relative, baseWithSlash).href;
  }
}
