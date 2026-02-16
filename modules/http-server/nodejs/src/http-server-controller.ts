import swagger from "@fastify/swagger";
import apiReference from "@scalar/fastify-api-reference";
import type { ResourceContext, ResourceInstance, RuntimeResource } from "@citorun/sdk";
import Fastify, { FastifyInstance } from "fastify";
import { HttpServerApi } from "./http-api-controller.js";

type HttpRouteResource = RuntimeResource & {
  metadata?: { path?: string; method?: string };
  path?: string;
  method?: string;
  handler?: HttpHandlerSpec;
  request?: HttpRequestSchema;
  response?: {
    status?: number;
    headers?: Record<string, string>;
    body?: any;
  };
};

type HttpServerResource = RuntimeResource & {
  host?: string;
  port?: number;
  baseUrl?: string;
  openapi?: {
    info: {
      title: string;
      version: string;
    };
  };
  mounts?: Array<{
    path?: string;
    type?: string;
  }>;
};

type HttpApiResource = RuntimeResource & {
  routes?: Array<
    | string
    | {
        request?: {
          path?: string;
          method?: string;
          query?: Record<string, any>;
          body?: Record<string, any>;
          headers?: Record<string, any>;
        };
        handler?: HttpHandlerSpec;
        response?: {
          status?: number;
          headers?: Record<string, string>;
          body?: any;
        };
      }
  >;
};

type HttpHandlerSpec =
  | string
  | {
      name?: string;
      inputs?: Record<string, any>;
    };

type HttpRequestSchema = {
  query?: Record<string, any>;
  body?: Record<string, any>;
  headers?: Record<string, any>;
};

class HttpServer implements ResourceInstance {
  private releaseHold: (() => void) | null = null;
  private readonly app: FastifyInstance;
  private readonly host: string;
  private readonly port: number;
  private readonly baseUrl: string;
  private readonly resource: HttpServerResource;
  private readonly ctx: ResourceContext;

  constructor(resource: HttpServerResource, ctx: ResourceContext) {
    this.resource = resource;
    this.ctx = ctx;
    this.host = resource.host || "0.0.0.0";
    this.port = Number(resource.port || 0);
    this.baseUrl = resource.baseUrl ?? `http://${this.host}:${this.port}`;

    if (!this.port) {
      throw new Error("Http.Server port is required");
    }
    this.app = Fastify({ logger: true });
  }

  async init() {
    this.setupPlugins();
    this.setupRoutes();
  }

  private async setupPlugins() {
    if (this.resource.openapi) {
      const servers = [];
      // const routesByName = new Map<string, HttpRouteResource>();
      const mounts = this.resource.mounts || [];
      const prefixes = new Set();
      for (const mount of mounts) {
        prefixes.add(mount.path || "");
      }
      for (const prefix of prefixes) {
        servers.push({ url: this.baseUrl + prefix });
      }
      await this.app.register(swagger, {
        openapi: {
          openapi: "3.0.0",
          info: this.resource.openapi.info,
          servers,
        },
      });
      await this.app.register(apiReference, {
        routePrefix: "/reference",
      });
    }
  }

  private setupRoutes(): void {
    // const routesByName = new Map<string, HttpRouteResource>();
    const mounts = this.resource.mounts || [];
    // const resolveSchema = createSchemaResolver(this.ctx);
    for (const mount of mounts) {
      const type = mount.type || "";
      const { kind, name } = parseType(type);
      const prefix = mount.path || "";

      const api: HttpServerApi = this.ctx.getResourcesByName(kind, name) as any;

      if (!api) {
        throw new Error(`Failed to mount Http.Api at "${prefix}": ${type} not found`);
      }
      api.register(this.app, prefix);
    }
  }

  async run(): Promise<void> {
    this.releaseHold = this.ctx.acquireHold();
    try {
      await this.app.listen({ host: this.host, port: this.port });
      await this.ctx.emitEvent(`${this.resource.metadata.name}.Listening`, {
        port: this.port,
        host: this.host,
        baseUrl: this.baseUrl,
        mounts: this.resource.mounts,
        openapi: this.resource.openapi,
      });
    } catch (error) {
      await this.app.close();
      if (this.releaseHold) {
        this.releaseHold();
        this.releaseHold = null;
      }
      throw error;
    }
  }

  async teardown(): Promise<void> {
    if (this.releaseHold) {
      this.releaseHold();
      this.releaseHold = null;
    }
    await this.app.close();
  }
}

export function create(
  resource: HttpServerResource,
  ctx: ResourceContext,
): ResourceInstance | null {
  return new HttpServer(resource, ctx);
}

function parseType(type: string): { kind: string; name: string } {
  const separator = type.lastIndexOf(".");
  if (separator <= 0 || separator === type.length - 1) {
    return { kind: "", name: "" };
  }
  return { kind: type.slice(0, separator), name: type.slice(separator + 1) };
}
