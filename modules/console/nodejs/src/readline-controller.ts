import type { ResourceContext, ResourceInstance, RuntimeResource } from "@telorun/sdk";
import * as rl from "readline";

type ConsoleReadLineResource = RuntimeResource & {
  prompt: string;
};

class ConsoleReadLine implements ResourceInstance {
  private value: string = "";

  constructor(private readonly resource: ConsoleReadLineResource) {}

  async invoke(): Promise<{ value: string }> {
    const iface = rl.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    this.value = await new Promise<string>((resolve) => {
      iface.question(`${this.resource.prompt}: `, (answer) => {
        iface.close();
        resolve(answer);
      });
    });
    return { value: this.value };
  }
}

export function register(): void {}

export async function create(
  resource: ConsoleReadLineResource,
  _ctx: ResourceContext,
): Promise<ConsoleReadLine> {
  return new ConsoleReadLine(resource);
}
