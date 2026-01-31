import type {
  ModuleContext,
  ModuleCreateContext,
  ResourceInstance,
  RuntimeResource,
} from '@diglyai/sdk';
import swagger from '@fastify/swagger';
import apiReference from '@scalar/fastify-api-reference';
import type { FastifyInstance } from 'fastify';

type OpenApiResource = RuntimeResource & {
  apis?: string[];
  info?: Record<string, any>;
  path?: string;
};

type HttpServerResource = RuntimeResource & {
  host?: string;
  port?: number;
  mounts?: Array<{ path?: string; type?: string }>;
};

type HttpApiResource = RuntimeResource & {
  routes?: Array<
    | string
    | {
        request?: { path?: string; method?: string };
      }
  >;
};

type HttpRouteResource = RuntimeResource & {
  metadata?: { path?: string; method?: string };
  path?: string;
  method?: string;
};

type SpecLike<T extends RuntimeResource> = T & Record<string, any>;

function getResourceConfig<T extends RuntimeResource>(
  resource: T,
): SpecLike<T> {
  return resource as SpecLike<T>;
}

export function register(_ctx: ModuleContext): void {}

export function create(
  resource: OpenApiResource,
  ctx: ModuleCreateContext,
): ResourceInstance {
  const openApiResource = resource;
  const config = getResourceConfig(openApiResource);
  const apiRefs = config.apis || [];
  if (apiRefs.length === 0) {
    throw new Error(`OpenApi.Spec "${resource.metadata.name}" is missing apis`);
  }

  const handler = (payload?: any) => {
    const serverResource = payload?.resource as HttpServerResource | undefined;
    const app = payload?.app as FastifyInstance | undefined;
    if (!serverResource || !app) {
      throw new Error(
        `OpenApi.Spec handler missing Http.Server resource or Fastify app`,
      );
    }

    const matchedApis = resolveApis(apiRefs, ctx);
    const mounts = getResourceConfig(serverResource).mounts || [];
    const servers = buildServers(serverResource, mounts, matchedApis);
    if (servers.length === 0) {
      return;
    }

    const paths = buildPaths(matchedApis, mounts);

    const info =
      config.info && typeof config.info === 'object'
        ? config.info
        : {
            title: resource.metadata.name,
            version: resource.version || '1.0.0',
          };

    const routePrefix = config.path || `/openapi/${resource.metadata.name}`;

    app.register(swagger, {
      openapi: {
        openapi: '3.0.0',
        info,
        servers,
        paths,
      },
      exposeRoute: true,
      routePrefix,
    });
    app.register(apiReference, {
      routePrefix,
    });
  };

  const httpServers = ctx.getResources('Http.Server');

  return {
    init: async () => {
      // Register listeners after all resources are initialized
      for (const server of httpServers) {
        ctx.onResourceEvent(
          'Http.Server',
          server.metadata.name,
          'Ready',
          handler,
        );
      }
    },
    teardown: () => {
      for (const server of httpServers) {
        ctx.offResourceEvent(
          'Http.Server',
          server.metadata.name,
          'Ready',
          handler,
        );
      }
    },
  };
}

function resolveApis(
  apiRefs: string[],
  ctx: ModuleCreateContext,
): Array<HttpApiResource | HttpRouteResource> {
  const apis: Array<HttpApiResource | HttpRouteResource> = [];
  for (const ref of apiRefs) {
    const { kind, name } = parseRef(ref);
    if (!kind || !name) {
      throw new Error(`Reference not found: ${ref}`);
    }
    if (kind !== 'Http.Api' && kind !== 'Http.Route') {
      throw new Error(`Reference not supported: ${ref}`);
    }
    const resource = ctx.kernel.registry.get(kind)?.get(name);
    if (!resource) {
      throw new Error(`Reference not found: ${ref}`);
    }
    apis.push(resource as HttpApiResource | HttpRouteResource);
  }
  return apis;
}

function buildServers(
  server: HttpServerResource,
  mounts: Array<{ path?: string; type?: string }>,
  apis: Array<HttpApiResource | HttpRouteResource>,
): Array<{ url: string }> {
  const config = getResourceConfig(server);
  const host = config.host || '0.0.0.0';
  const port = Number(config.port || 0);
  if (!port) {
    return [];
  }

  // Server URL should be the base URL without mount paths
  // Paths will include the mount prefix
  return [{ url: `http://${host}:${port}` }];
}

function buildPaths(
  apis: Array<HttpApiResource | HttpRouteResource>,
  mounts: Array<{ path?: string; type?: string }>,
): Record<string, any> {
  const paths: Record<string, any> = {};
  const mountPrefixByType = new Map<string, string>();
  for (const mount of mounts) {
    if (mount.type) {
      mountPrefixByType.set(mount.type, mount.path || '');
    }
  }

  for (const api of apis) {
    const prefix =
      mountPrefixByType.get(`${api.kind}.${api.metadata.name}`) || '';
    if (api.kind === 'Http.Route') {
      const config = getResourceConfig(api);
      const path = joinPath(prefix, api.metadata?.path || config.path || '');
      const method = (
        api.metadata?.method ||
        config.method ||
        'GET'
      ).toLowerCase();
      if (!path) {
        continue;
      }
      if (!paths[path]) {
        paths[path] = {};
      }
      paths[path][method] = { responses: { '200': { description: 'OK' } } };
      continue;
    }

    const routes = getResourceConfig(api).routes || [];
    for (const route of routes) {
      if (typeof route === 'string') {
        continue;
      }
      const request = route.request || {};
      const path = joinPath(prefix, request.path || '');
      const method = (request.method || 'GET').toLowerCase();
      if (!path) {
        continue;
      }
      if (!paths[path]) {
        paths[path] = {};
      }
      paths[path][method] = { responses: { '200': { description: 'OK' } } };
    }
  }

  return paths;
}

function parseRef(ref: string): { kind: string; name: string } {
  const separator = ref.lastIndexOf('.');
  if (separator <= 0 || separator === ref.length - 1) {
    return { kind: '', name: '' };
  }
  return { kind: ref.slice(0, separator), name: ref.slice(separator + 1) };
}

function joinPath(prefix: string, path: string): string {
  if (!prefix) {
    return path;
  }
  if (!path) {
    return prefix;
  }
  const trimmedPrefix = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix;
  const trimmedPath = path.startsWith('/') ? path : `/${path}`;
  return `${trimmedPrefix}${trimmedPath}`;
}
