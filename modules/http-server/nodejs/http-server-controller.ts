import type {
    ControllerContext,
    ResourceContext,
    ResourceInstance,
    RuntimeResource,
} from '@diglyai/sdk';
import Ajv, { ValidateFunction } from 'ajv';
import Fastify, { FastifyInstance } from 'fastify';

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

export function register(ctx: ControllerContext): void {
  ctx.on('Runtime.Starting', () => {});
}

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

const ajv = new Ajv({ allErrors: true, strict: false });
const requestValidators = new Map<string, ValidateFunction>();

type SchemaResolver = (ref: string) => Record<string, any> | null;

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
    this.host = resource.host || '0.0.0.0';
    this.port = Number(resource.port || 0);
    this.baseUrl = resource.baseUrl ?? `http://${this.host}:${this.port}`;

    if (!this.port) {
      throw new Error('Http.Server port is required');
    }

    this.app = Fastify();
    this.setupRoutes();
  }

  private setupRoutes(): void {
    // const routesByName = new Map<string, HttpRouteResource>();
    const mounts = this.resource.mounts || [];
    // const resolveSchema = createSchemaResolver(this.ctx);

    for (const mount of mounts) {
      const type = mount.type || '';
      const { kind, name } = parseType(type);
      const prefix = mount.path || '';

      const api = this.ctx.getResourcesByName('Http.Api', name);
      if (!api) {
        throw new Error(
          `Failed to mount Http.Api at "${prefix}": ${type} not found`,
        );
      }
      // registerHttpApi(
      //   this.app,
      //   api,
      //   routesByName,
      //   this.ctx,
      //   prefix,
      //   resolveSchema,
      // );
    }
  }

  async init(): Promise<void> {
    this.releaseHold = this.ctx.acquireHold();
    try {
      // console.log(
      //   `Http.Server:${this.resource.metadata.name} starting on ${this.baseUrl}...`,
      // );
      await this.app.listen({ host: this.host, port: this.port });
      // console.log(`Http.Server listening on ${this.baseUrl}`);
      await this.ctx.emitEvent('Listening', {
        resource: {
          kind: this.resource.kind,
          name: this.resource.metadata.name,
          port: this.port,
          host: this.host,
          baseUrl: this.baseUrl,
          mounts: this.resource.mounts,
        },
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
  const separator = type.lastIndexOf('.');
  if (separator <= 0 || separator === type.length - 1) {
    return { kind: '', name: '' };
  }
  return { kind: type.slice(0, separator), name: type.slice(separator + 1) };
}
