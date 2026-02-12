import {
  ControllerContext,
  ResourceContext,
  ResourceInstance,
} from '@diglyai/sdk';
import { Static, Type } from '@sinclair/typebox';
import { FastifyInstance } from 'fastify';

const HttpApiRouteManifest = Type.Object({
  request: Type.Object({
    path: Type.String(),
    method: Type.String(),
    schema: Type.Optional(
      Type.Object({
        params: Type.Optional(Type.Any()),
        query: Type.Optional(Type.Any()),
        body: Type.Optional(Type.Any()),
        headers: Type.Optional(Type.Any()),
      }),
    ),
  }),
  handler: Type.Object({
    kind: Type.String(),
    name: Type.String(),
    inputs: Type.Optional(Type.Any()),
  }),
  response: Type.Object({
    status: Type.Union([
      Type.Number({ minimum: 100, maximum: 599 }),
      Type.String(),
    ]),
    statuses: Type.Record(
      Type.String(),
      Type.Object({
        schema: Type.Optional(
          Type.Object({
            query: Type.Optional(Type.Any()),
            body: Type.Optional(Type.Any()),
            headers: Type.Optional(Type.Any()),
          }),
        ),
        headers: Type.Optional(Type.Record(Type.String(), Type.String())),
        body: Type.Optional(Type.Any()),
      }),
    ),
  }),
});
type HttpApiRouteManifest = Static<typeof HttpApiRouteManifest>;

const HttpApiManifest = Type.Object({
  routes: Type.Array(HttpApiRouteManifest),
});
type HttpApiManifest = Static<typeof HttpApiManifest>;

export async function register(ctx: ControllerContext): Promise<void> {}

export class HttpServerApi implements ResourceInstance {
  constructor(
    private readonly ctx: ResourceContext,
    readonly manifest: HttpApiManifest,
  ) {}

  async init() {}

  register(app: FastifyInstance, prefix = '') {
    if (prefix) {
      app.register(
        async (scoped) => {
          this.registerRoutes(scoped);
        },
        { prefix },
      );
    } else {
      this.registerRoutes(app);
    }
  }

  private registerRoutes(app: FastifyInstance) {
    const routes = this.manifest.routes || [];
    for (const route of routes) {
      this.registerRoute(app, route);
    }
  }

  private registerRoute(app: FastifyInstance, route: HttpApiRouteManifest) {
    const handler = resolveHandlerName(route.handler);
    const schema: any = {};
    if (route.request.schema?.query) {
      schema.querystring = route.request.schema?.query;
    }
    if (route.request.schema?.params) {
      schema.params = route.request.schema?.params;
    }
    if (route.request.schema?.body) {
      schema.body = route.request.schema?.body;
    }
    if (route.request.schema?.headers) {
      schema.headers = route.request.schema?.headers;
    }
    schema.response = Object.keys(route.response.statuses).reduce(
      (acc, status) => {
        const statusConfig = route.response.statuses[status];
        if (statusConfig.schema) {
          acc[status] = {};
          if (statusConfig.schema.query) {
            acc[status].querystring = statusConfig.schema.query;
          }
          if (statusConfig.schema.body) {
            acc[status].body = statusConfig.schema.body;
          }
          if (statusConfig.schema.headers) {
            acc[status].headers = statusConfig.schema.headers;
          }
        }
        return acc;
      },
      {} as Record<string, any>,
    );

    app.route({
      method: route.request.method,
      url: route.request.path,
      schema,
      handler: async (request, reply) => {
        // const resolveSchema = createSchemaResolver(ctx);
        const requestPayload = {
          params: request.params,
          query: request.query,
          body: request.body,
          headers: request.headers,
          method: request.method,
          url: request.url,
        };
        // validateRequestSchemas(route.request, requestPayload, resolveSchema);
        const result = await this.ctx.invoke(
          handler.kind,
          handler.name,
          resolveHandlerInputs(route.handler, requestPayload),
        );
        // Handle response with body/headers mapping

        const response = route.response;

        // Set status
        const status =
          typeof response.status === 'string'
            ? this.ctx.expandValue(response.status, { result })
            : response.status;
        if (response.status) {
          reply.code(status);
        }
        const statusConfig = response.statuses[response.status];
        if (!statusConfig) {
          return reply
            .code(500)
            .send({ error: 'Invalid response status configuration' });
        }
        // Map headers if specified
        if (statusConfig.headers) {
          reply.headers(this.ctx.expandValue(statusConfig.headers, { result }));
        }

        // Map body if specified
        if (statusConfig.body !== undefined) {
          const mappedBody = this.ctx.expandValue(statusConfig.body, {
            result,
          });
          if (statusConfig.schema && statusConfig.schema.body) {
            this.ctx.validateSchema(mappedBody, statusConfig.schema.body);
          }
          return reply.send(mappedBody);
        }

        // No body mapping, send result as-is
        return reply.send(result);
      },
    });
  }
}

export async function create(
  resource: HttpApiManifest,
  ctx: ResourceContext,
): Promise<HttpServerApi> {
  ctx.validateSchema(resource, HttpApiManifest);
  return new HttpServerApi(ctx, resource);
}

function resolveHandlerName(handler: any): { kind: string; name: string } {
  if (typeof handler === 'string') {
    const [kind, name] = handler.split('/');
    return { kind, name };
  }
  if (
    handler &&
    typeof handler === 'object' &&
    typeof handler.name === 'string' &&
    typeof handler.kind === 'string'
  ) {
    return { name: handler.name, kind: handler.kind };
  }
  throw new Error('Unable to resolve handler');
}

function resolveHandlerInputs(
  handler: any,
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
