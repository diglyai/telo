import * as fs from "fs/promises";
import * as path from "path";
import * as yaml from "js-yaml";
import type { ManifestAdapter, ManifestSourceData } from "./manifest-adapter.js";

export class LocalFileAdapter implements ManifestAdapter {
  supports(pathOrUrl: string): boolean {
    return !pathOrUrl.startsWith("http://") && !pathOrUrl.startsWith("https://");
  }

  async read(pathOrUrl: string): Promise<ManifestSourceData> {
    const stat = await fs.stat(pathOrUrl);
    const filePath = stat.isDirectory() ? path.join(pathOrUrl, "module.yaml") : pathOrUrl;
    return this.readFile(filePath);
  }

  async readAll(pathOrUrl: string): Promise<ManifestSourceData[]> {
    const stat = await fs.stat(pathOrUrl);
    if (stat.isDirectory()) {
      const results: ManifestSourceData[] = [];
      await this.collectYamlFiles(pathOrUrl, results);
      return results;
    }
    return [await this.readFile(pathOrUrl)];
  }

  resolveRelative(base: string, relative: string): string {
    return path.resolve(base, relative);
  }

  private async readFile(filePath: string): Promise<ManifestSourceData> {
    const abs = path.resolve(filePath);
    const content = await fs.readFile(filePath, "utf-8");
    return {
      documents: yaml.loadAll(content),
      source: filePath,
      baseDir: path.dirname(abs),
      uriBase: `file://localhost${abs.replace(/\\/g, "/")}`,
    };
  }

  private async collectYamlFiles(dirPath: string, results: ManifestSourceData[]): Promise<void> {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        await this.collectYamlFiles(fullPath, results);
      } else if (entry.isFile() && this.isYamlFile(entry.name)) {
        results.push(await this.readFile(fullPath));
      }
    }
  }

  private isYamlFile(filename: string): boolean {
    return filename.endsWith(".yaml") || filename.endsWith(".yml");
  }
}
