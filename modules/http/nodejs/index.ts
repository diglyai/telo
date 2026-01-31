import type {
  ModuleContext,
  ModuleCreateContext,
  ResourceInstance,
  RuntimeResource,
} from '@diglyai/sdk';
import Ajv, { ErrorObject, ValidateFunction } from 'ajv';
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

export function register(ctx: ModuleContext): void {
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

export function create(
  resource: HttpServerResource,
  ctx: ModuleCreateContext,
): ResourceInstance | null {
  if (resource.kind !== 'Http.Server') {
    return null;
  }

  const server = resource;
  const host = server.host || '0.0.0.0';
  const port = Number(server.port || 0);
  const baseUrl = resource.baseUrl ?? `http://${host}:${port}`;
  if (!port) {
    throw new Error('Http.Server port is required');
  }

  const app: FastifyInstance = Fastify();

  const routes = ctx.getResources('Http.Route') as HttpRouteResource[];
  const apis = ctx.getResources('Http.Api') as HttpApiResource[];
  const routesByName = new Map<string, HttpRouteResource>();
  const apisByName = new Map<string, HttpApiResource>();
  for (const route of routes) {
    if (route.metadata?.name) {
      routesByName.set(route.metadata.name, route);
    }
  }
  for (const api of apis) {
    if (api.metadata?.name) {
      apisByName.set(api.metadata.name, api);
    }
  }

  const mounts = server.mounts || [];
  const resolveSchema = createSchemaResolver(ctx);
  if (mounts.length === 0) {
    for (const route of routes) {
      registerHttpRoute(app, route, ctx, '', resolveSchema);
    }
  } else {
    for (const mount of mounts) {
      const type = mount.type || '';
      const { kind, name } = parseType(type);
      const prefix = mount.path || '';
      if (kind === 'Http.Route') {
        const route = routesByName.get(name) || apisByName.get(name);
        if (!route) {
          throw new Error(`Http.Route not found: ${type}`);
        }
        if (route.kind === 'Http.Api') {
          registerHttpApi(
            app,
            route as HttpApiResource,
            routesByName,
            ctx,
            prefix,
            resolveSchema,
          );
        } else {
          registerHttpRoute(
            app,
            route as HttpRouteResource,
            ctx,
            prefix,
            resolveSchema,
          );
        }
      } else if (kind === 'Http.Api') {
        const api = apisByName.get(name);
        if (!api) {
          throw new Error(`Http.Api not found: ${type}`);
        }
        registerHttpApi(app, api, routesByName, ctx, prefix, resolveSchema);
      } else {
        throw new Error(`Unsupported mount type: ${type}`);
      }
    }
  }

  let releaseHold: (() => void) | null = null;

  return {
    init: async () => {
      releaseHold = ctx.acquireHold(`Http.Server:${resource.metadata.name}`);
      try {
        await ctx.emitResourceEvent(
          'Http.Server',
          resource.metadata.name,
          'Ready',
          {
            resource: server,
            app,
          },
        );
        await app.listen({ host, port });
        console.log(`Http.Server listening on ${baseUrl}`);
      } catch (error) {
        releaseHold();
        releaseHold = null;
        throw error;
      }
    },
    teardown: async () => {
      if (releaseHold) {
        releaseHold();
        releaseHold = null;
      }
      await app.close();
    },
  };
}

function parseType(type: string): { kind: string; name: string } {
  const separator = type.lastIndexOf('.');
  if (separator <= 0 || separator === type.length - 1) {
    return { kind: '', name: '' };
  }
  return { kind: type.slice(0, separator), name: type.slice(separator + 1) };
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

function registerHttpApi(
  app: FastifyInstance,
  api: HttpApiResource,
  routesByName: Map<string, HttpRouteResource>,
  ctx: ModuleCreateContext,
  prefix = '',
  resolveSchema: SchemaResolver,
): void {
  const routes = api.routes || [];
  for (const route of routes) {
    if (typeof route === 'string') {
      const { kind, name } = parseType(route);
      if (kind !== 'Http.Route') {
        throw new Error(`Http.Api route must reference Http.Route: ${route}`);
      }
      const routeResource = routesByName.get(name);
      if (!routeResource) {
        throw new Error(`Http.Route not found: ${route}`);
      }
      registerHttpRoute(app, routeResource, ctx, prefix, resolveSchema);
      continue;
    }
    registerHttpInlineRoute(app, route, ctx, prefix, resolveSchema);
  }
}

function registerHttpRoute(
  app: FastifyInstance,
  route: HttpRouteResource,
  ctx: ModuleCreateContext,
  prefix = '',
  resolveSchema: SchemaResolver,
): void {
  const meta = route.metadata || {};
  const url = joinPath(prefix, meta.path || route.path || '');
  const method = (meta.method || route.method || 'GET').toUpperCase();
  if (!url) {
    return;
  }
  assertRequestSchemaRefs(route.request, resolveSchema);
  assertResponseSchemaRefs(route.response, resolveSchema);

  app.route({
    method,
    url,
    handler: async (request, reply) => {
      const resolveSchema = createSchemaResolver(ctx);
      const requestPayload = {
        params: request.params,
        query: request.query,
        body: request.body,
        headers: request.headers,
        method: request.method,
        url: request.url,
      };
      validateRequestSchemas(route.request, requestPayload, resolveSchema);
      if (route.handler) {
        const handlerName = resolveHandlerName(route.handler);
        if (!handlerName) {
          throw new Error('Http.Route handler name is required');
        }
        const result = await ctx.kernel.execute(
          handlerName,
          resolveHandlerInputs(route.handler, requestPayload),
          { request, reply },
        );

        // Handle response with body/headers mapping
        if (route.response) {
          const response = route.response;

          // Set status
          if (response.status) {
            reply.code(response.status);
          }

          // Map headers if specified
          if (response.headers && typeof response.headers === 'object') {
            const mappedHeaders: Record<string, string> = {};
            for (const [key, value] of Object.entries(response.headers)) {
              if (typeof value === 'string') {
                // Simple template replacement: ${{ result.field }} -> result.field
                mappedHeaders[key] = value.replace(
                  /\$\{\{\s*result\.(\w+)\s*\}\}/gi,
                  (_, field) => {
                    return result?.[field] ?? '';
                  },
                );
              } else {
                mappedHeaders[key] = String(value);
              }
            }
            reply.headers(mappedHeaders);
          }

          // Map body if specified
          if (response.body !== undefined) {
            const mappedBody = mapResponseValue(response.body, result);
            return reply.send(mappedBody);
          }

          // No body mapping, send result as-is
          return reply.send(result);
        }

        // No response config: Legacy direct result handling
        if (result && typeof result === 'object') {
          if (result.status) {
            reply.code(result.status);
          }
          if (result.headers) {
            reply.headers(result.headers);
          }
          if (Object.prototype.hasOwnProperty.call(result, 'body')) {
            return reply.send(result.body);
          }
        }
        return reply.send(result);
      }

      if (route.response) {
        const response = route.response || {};
        if (response.status) {
          reply.code(response.status);
        }
        if (response.headers) {
          reply.headers(response.headers);
        }
        return reply.send(response.body ?? null);
      }

      reply.code(501);
      return reply.send({ error: 'No handler configured' });
    },
  });
}

function mapResponseValue(value: any, result: any): any {
  if (typeof value === 'string') {
    // Simple template replacement: ${{ result.field }} -> result.field
    return value.replace(/\$\{\{\s*result\.(\w+)\s*\}\}/gi, (_, field) => {
      return result?.[field] ?? '';
    });
  }

  if (Array.isArray(value)) {
    return value.map((item) => mapResponseValue(item, result));
  }

  if (value && typeof value === 'object') {
    const mapped: Record<string, any> = {};
    for (const [key, val] of Object.entries(value)) {
      mapped[key] = mapResponseValue(val, result);
    }
    return mapped;
  }

  return value;
}

function registerHttpInlineRoute(
  app: FastifyInstance,
  route: {
    request?: { path?: string; method?: string };
    handler?: string;
    response?: {
      status?: number;
      headers?: Record<string, string>;
      body?: any;
    };
  },
  ctx: ModuleCreateContext,
  prefix = '',
  resolveSchema: SchemaResolver,
): void {
  const request = route.request || {};
  const url = joinPath(prefix, request.path || '');
  const method = (request.method || 'GET').toUpperCase();
  if (!url) {
    return;
  }
  assertRequestSchemaRefs(
    route.request as HttpRequestSchema | undefined,
    resolveSchema,
  );
  assertResponseSchemaRefs(route.response, resolveSchema);

  app.route({
    method,
    url,
    handler: async (req, reply) => {
      const resolveSchema = createSchemaResolver(ctx);
      const requestPayload = {
        params: req.params,
        query: req.query,
        body: req.body,
        headers: req.headers,
        method: req.method,
        url: req.url,
      };
      validateRequestSchemas(route.request, requestPayload, resolveSchema);
      if (route.handler) {
        const handlerName = resolveHandlerName(route.handler);
        if (!handlerName) {
          throw new Error('Http.Api handler name is required');
        }
        const result = await ctx.kernel.execute(
          handlerName,
          resolveHandlerInputs(route.handler, requestPayload),
          { request: req, reply },
        );

        // Handle response with body/headers mapping
        if (route.response) {
          const response = route.response;

          // Set status
          if (response.status) {
            reply.code(response.status);
          }

          // Map headers if specified
          if (response.headers && typeof response.headers === 'object') {
            const mappedHeaders: Record<string, string> = {};
            for (const [key, value] of Object.entries(response.headers)) {
              if (typeof value === 'string') {
                mappedHeaders[key] = value.replace(
                  /\$\{\{\s*result\.(\w+)\s*\}\}/gi,
                  (_, field) => {
                    return result?.[field] ?? '';
                  },
                );
              } else {
                mappedHeaders[key] = String(value);
              }
            }
            reply.headers(mappedHeaders);
          }

          // Map body if specified
          if (response.body !== undefined) {
            const mappedBody = mapResponseValue(response.body, result);
            return reply.send(mappedBody);
          }

          // No body mapping, send result as-is
          return reply.send(result);
        }

        // No response config: Legacy direct result handling
        if (result && typeof result === 'object') {
          if (result.status) {
            reply.code(result.status);
          }
          if (result.headers) {
            reply.headers(result.headers);
          }
          if (Object.prototype.hasOwnProperty.call(result, 'body')) {
            return reply.send(result.body);
          }
        }
        return reply.send(result);
      }

      if (route.response) {
        if (route.response.status) {
          reply.code(route.response.status);
        }
        if (route.response.headers) {
          reply.headers(route.response.headers);
        }
        return reply.send(route.response.body ?? null);
      }

      reply.code(501);
      return reply.send({ error: 'No handler configured' });
    },
  });
}

function resolveHandlerName(handler: HttpHandlerSpec): string | null {
  if (typeof handler === 'string') {
    return handler;
  }
  if (
    handler &&
    typeof handler === 'object' &&
    typeof handler.name === 'string'
  ) {
    return handler.name;
  }
  return null;
}

function resolveHandlerInputs(
  handler: HttpHandlerSpec,
  requestPayload: Record<string, any>,
): any {
  if (typeof handler === 'string') {
    return requestPayload;
  }
  if (!handler || typeof handler !== 'object') {
    return requestPayload;
  }
  if (!handler.inputs) {
    return requestPayload;
  }
  const context = { request: requestPayload, ...requestPayload };
  return resolveTemplateInputs(handler.inputs, context);
}

function resolveTemplateInputs(value: any, context: Record<string, any>): any {
  if (typeof value === 'string') {
    const match = value.match(/^\s*\$\{\{\s*([^}]+)\s*\}\}\s*$/);
    if (match) {
      return resolveTemplatePath(match[1], context);
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => resolveTemplateInputs(item, context));
  }
  if (value && typeof value === 'object') {
    const resolved: Record<string, any> = {};
    for (const [key, entry] of Object.entries(value)) {
      resolved[key] = resolveTemplateInputs(entry, context);
    }
    return resolved;
  }
  return value;
}

function resolveTemplatePath(
  pathExpression: string,
  context: Record<string, any>,
): any {
  const parts = pathExpression.trim().split('.').filter(Boolean);
  let current: any = context;
  for (const part of parts) {
    if (
      !current ||
      (typeof current !== 'object' && typeof current !== 'function')
    ) {
      return undefined;
    }
    current = current[part];
  }
  return current;
}

function validateRequestSchemas(
  request: { query?: any; body?: any; headers?: any } | undefined,
  payload: { query: any; body: any; headers: any },
  resolveSchema: SchemaResolver,
): void {
  if (!request) {
    return;
  }
  validateSchemaPart('query', request.query, payload.query, resolveSchema);
  validateSchemaPart('body', request.body, payload.body, resolveSchema);
  validateSchemaPart(
    'headers',
    request.headers,
    payload.headers,
    resolveSchema,
  );
}

function validateSchemaPart(
  part: string,
  schema: any,
  value: any,
  resolveSchema: SchemaResolver,
): void {
  if (!schema) {
    return;
  }
  let normalizedSchema = schema;
  if (typeof schema === 'string') {
    const resolved = resolveSchema(schema);
    if (!resolved) {
      throw new Error(`Reference not found: ${schema}`);
    }
    normalizedSchema = resolved;
  }
  const normalized = normalizeRequestSchema(normalizedSchema);
  const key = `${part}:${JSON.stringify(normalized)}`;
  let validate = requestValidators.get(key);
  if (!validate) {
    validate = ajv.compile(normalized);
    requestValidators.set(key, validate);
  }
  if (!validate(value)) {
    const error: any = new Error(formatAjvErrors(validate.errors, part));
    error.statusCode = 400;
    throw error;
  }
}

function normalizeRequestSchema(
  schema: Record<string, any>,
): Record<string, any> {
  if (isJsonSchema(schema)) {
    return schema;
  }
  const properties: Record<string, any> = {};
  const required: string[] = [];
  for (const [key, value] of Object.entries(schema)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const { required: isRequired, ...rest } = value as Record<string, any>;
      properties[key] = Object.keys(rest).length === 0 ? {} : rest;
      if (isRequired) {
        required.push(key);
      }
    } else if (typeof value === 'string') {
      properties[key] = { type: value };
    } else {
      properties[key] = {};
    }
  }
  const normalized: Record<string, any> = { type: 'object', properties };
  if (required.length > 0) {
    normalized.required = required;
  }
  return normalized;
}

function isJsonSchema(schema: Record<string, any>): boolean {
  return (
    Object.prototype.hasOwnProperty.call(schema, '$schema') ||
    Object.prototype.hasOwnProperty.call(schema, 'type') ||
    Object.prototype.hasOwnProperty.call(schema, 'properties') ||
    Object.prototype.hasOwnProperty.call(schema, 'allOf') ||
    Object.prototype.hasOwnProperty.call(schema, 'anyOf') ||
    Object.prototype.hasOwnProperty.call(schema, 'oneOf') ||
    Object.prototype.hasOwnProperty.call(schema, 'not')
  );
}

function formatAjvErrors(
  errors?: ErrorObject[] | null,
  label?: string,
): string {
  if (!errors || errors.length === 0) {
    return 'Validation failed';
  }
  const prefix = label ? `${label}: ` : '';
  return (
    prefix +
    errors
      .map((err) => {
        const path =
          err.instancePath && err.instancePath.length > 0
            ? err.instancePath
            : '/';
        const message = err.message || 'is invalid';
        return `${path} ${message}`;
      })
      .join('; ')
  );
}

function createSchemaResolver(ctx: ModuleCreateContext): SchemaResolver {
  return (ref: string) => {
    const name = normalizeSchemaRefName(ref);
    if (!name) {
      return null;
    }
    const matches: RuntimeResource[] = [];
    for (const resourcesByName of ctx.kernel.registry.values()) {
      const resource = resourcesByName.get(name);
      if (resource) {
        matches.push(resource);
      }
    }
    if (matches.length === 0) {
      return null;
    }
    if (matches.length > 1) {
      throw new Error(`Reference is ambiguous: ${ref}`);
    }
    const resource = matches[0] as any;
    const schema = resource.schema;
    if (!schema || typeof schema !== 'object') {
      throw new Error(`Reference has no target: ${ref}`);
    }
    return schema as Record<string, any>;
  };
}

function normalizeSchemaRefName(ref: string): string | null {
  if (!ref || typeof ref !== 'string') {
    return null;
  }
  if (ref.startsWith('#/')) {
    return ref.slice(2);
  }
  return ref;
}

function assertRequestSchemaRefs(
  request: HttpRequestSchema | undefined,
  resolveSchema: SchemaResolver,
): void {
  if (!request) {
    return;
  }
  assertSchemaRef(request.query, resolveSchema);
  assertSchemaRef(request.body, resolveSchema);
  assertSchemaRef(request.headers, resolveSchema);
}

function assertResponseSchemaRefs(
  response: { schema?: { body?: any; headers?: any } } | undefined,
  resolveSchema: SchemaResolver,
): void {
  if (!response?.schema) {
    return;
  }
  assertSchemaRef(response.schema.body, resolveSchema);
  assertSchemaRef(response.schema.headers, resolveSchema);
}

function assertSchemaRef(value: any, resolveSchema: SchemaResolver): void {
  if (typeof value !== 'string') {
    return;
  }
  const resolved = resolveSchema(value);
  if (!resolved) {
    throw new Error(`Reference not found: ${value}`);
  }
}
