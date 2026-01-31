# TemplateDefinition System

The TemplateDefinition system is a built-in runtime feature that enables dynamic resource generation through declarative templates with CEL-based control flow.

## Overview

Templates in DiglyAI allow you to:

- Define reusable resource blueprints with parameterized configuration
- Generate multiple resources through loops (`for` directives)
- Conditionally create resources (`if` directives)
- Compose templates recursively (templates can instantiate other templates)
- Use clean variable syntax without namespace prefixes

## Quick Start

### 1. Define a Template

```yaml
kind: TemplateDefinition
metadata:
  name: ApiServer
schema:
  type: object
  properties:
    name:
      type: string
      default: 'api'
    port:
      type: integer
      default: 8080
    regions:
      type: array
      items:
        type: string
      default: ['us-east', 'eu-west']
  required: [name, port]
resources:
  - for: 'region in regions'
    kind: Http.Server
    metadata:
      name: '${{ name }}-${{ region }}'
    port: ${{ port }}
    region: '${{ region }}'
```

### 2. Instantiate the Template

```yaml
kind: YourModule.ApiServer
metadata:
  name: ProductionApi
name: 'production'
port: 3000
regions: ['us-east-1', 'us-west-2', 'eu-central-1']
```

This will generate 3 `Http.Server` resources:

- `production-us-east-1` on port 3000
- `production-us-west-2` on port 3000
- `production-eu-central-1` on port 3000

## Schema Definition

The `schema` field uses JSONSchema to define template parameters:

```yaml
schema:
  type: object
  properties:
    paramName:
      type: string|integer|boolean|array|object
      default: <default value>
  required: [requiredParam1, requiredParam2]
```

**Variable Access**: Template variables are directly accessible in CEL expressions without prefixes:

- ✅ `${{ port }}`
- ✅ `${{ name }}-server`
- ❌ `${{ self.parameters.port }}` (old syntax, not needed)

## Control Flow

### `for` Directive - Loops

Generate multiple resources by iterating over collections.

**Array iteration:**

```yaml
resources:
  - for: 'region in regions'
    kind: Http.Server
    metadata:
      name: '${{ name }}-${{ region }}'
    region: '${{ region }}'
```

**Array with index:**

```yaml
resources:
  - for: 'index, region in regions'
    kind: Http.Server
    metadata:
      name: '${{ name }}-${{ index }}'
    port: ${{ basePort + index }}
```

**Object/Map iteration:**

```yaml
resources:
  - for: 'key, value in configMap'
    kind: Config.Entry
    metadata:
      name: '${{ key }}'
    value: '${{ value }}'
```

**Nested loops (array syntax):**

For nested iteration, use an array of `for` expressions. Each expression is evaluated sequentially, with variables from outer loops available in inner loops:

```yaml
resources:
  - for: ['endpoint in endpoints', 'method in endpoint.methods']
    kind: Http.Route
    metadata:
      name: '${{ endpoint.name }}-${{ method }}'
    path: '/api/${{ endpoint.path }}'
    method: '${{ method }}'
```

This creates a route for each combination of endpoint and method. Variables from the first loop (`endpoint`) are accessible in the second loop's expression (`endpoint.methods`).

**Multi-level nesting:**

```yaml
resources:
  - for:
      [
        'region in regions',
        'az in region.availabilityZones',
        'tier in ["web", "app", "db"]',
      ]
    kind: Compute.Instance
    metadata:
      name: '${{ region.name }}-${{ az }}-${{ tier }}'
```

### `if` Directive - Conditionals

Conditionally create resources based on boolean expressions.

```yaml
resources:
  - if: 'enableMonitoring'
    kind: Monitoring.Service
    metadata:
      name: '${{ name }}-monitor'

  - if: 'has(database) && database.enabled'
    kind: Database.Connection
    metadata:
      name: '${{ name }}-db'
    connectionString: '${{ database.url }}'
```

### Combining `for` and `if`

```yaml
resources:
  - for: 'region in regions'
    if: "region != 'test'"
    kind: Http.Server
    metadata:
      name: '${{ name }}-${{ region }}'
```

## Property-Level Control Flow

Control flow directives can also be used within resource properties:

```yaml
resources:
  - kind: Http.Api
    metadata:
      name: '${{ name }}'
    routes:
      - for: 'endpoint in endpoints'
        path: '/api/${{ endpoint }}'
        handler: 'Logic.JavaScript.Handle${{ endpoint }}'
    middleware:
      - if: 'enableCors'
        kind: 'Http.Middleware.Cors'
```

**Nested loops in properties:**

```yaml
resources:
  - kind: Http.Api
    metadata:
      name: 'rest-api'
    routes:
      - for: ['resource in resources', 'method in resource.methods']
        path: '/api/${{ resource.name }}'
        method: '${{ method }}'
        handler: 'Logic.JavaScript.${{ method }}${{ resource.name }}'
```

## Recursive Templates

Templates can instantiate other templates, enabling composition:

```yaml
---
# Base template
kind: TemplateDefinition
metadata:
  name: HttpServer
schema:
  type: object
  properties:
    name: { type: string }
    port: { type: integer }
resources:
  - kind: Http.Server
    metadata:
      name: '${{ name }}'
    port: ${{ port }}

---
# Composite template
kind: TemplateDefinition
metadata:
  name: MultiRegionApp
schema:
  type: object
  properties:
    serviceName: { type: string }
    regions: { type: array }
resources:
  - for: 'region, index in regions'
    kind: Template.HttpServer
    metadata:
      name: '${{ serviceName }}-${{ region }}'
    name: '${{ serviceName }}-${{ region }}'
    port: ${{ 8000 + index }}
```

**Expansion depth**: The runtime supports up to 10 levels of recursive expansion to prevent infinite loops.

## CEL Expression Context

Within template resources, the evaluation context contains:

- **Template variables**: All properties from the schema are directly accessible
- **Standard runtime context**: `env`, module namespaces, and resource references work as usual

### Built-in CEL Functions

All standard CEL functions are available:

- `has(field)` - Check if a field exists
- `size(collection)` - Get size of array/string/map
- `type(value)` - Get type of value
- String functions: `contains`, `startsWith`, `endsWith`, `matches`
- Math functions: `+`, `-`, `*`, `/`, `%`
- Logical operators: `&&`, `||`, `!`, `==`, `!=`, `<`, `>`, `<=`, `>=`

### Examples

```yaml
# String concatenation
name: '${{ serviceName }}-${{ region }}-api'

# Arithmetic
port: ${{ basePort + index * 100 }}

# Conditional expressions
enabled: ${{ has(features) && features.contains('monitoring') }}

# Array/collection operations
regionCount: ${{ size(regions) }}

# Complex expressions
route: "${{ has(basePath) ? basePath + '/' + endpoint : '/' + endpoint }}"
```

## Best Practices

### 1. Use Defaults in Schema

Provide sensible defaults for all optional parameters:

```yaml
schema:
  type: object
  properties:
    replicas:
      type: integer
      default: 3
    enableHA:
      type: boolean
      default: false
```

### 2. Validate Required Parameters

Mark critical parameters as required:

```yaml
schema:
  type: object
  properties:
    clusterName:
      type: string
  required: [clusterName]
```

### 3. Use Descriptive Resource Names

Generate unique, meaningful names:

```yaml
metadata:
  name: '${{ serviceName }}-${{ environment }}-${{ region }}'
```

### 4. Avoid Deep Nesting

Keep template recursion shallow (prefer 2-3 levels max) for maintainability.

### 5. Document Complex Schemas

Add descriptions in your schema for clarity:

```yaml
schema:
  type: object
  properties:
    replicas:
      type: integer
      default: 3
      description: 'Number of server replicas to deploy'
```

## Error Handling

### Common Errors

**Missing Template:**

```
Error: Template "ApiServer" not found for instance "MyApi"
```

Solution: Ensure the TemplateDefinition exists before instantiating it.

**Invalid `for` Expression:**

```
Error: Invalid 'for' expression: "x regions". Expected format: "item in collection"
```

Solution: Use correct syntax: `"item in collection"` or `"key, value in collection"`

**Recursion Limit:**

```
Error: Template expansion exceeded maximum depth of 10
```

Solution: Check for circular template references or simplify template composition.

**CEL Evaluation Error:**

```
Error: Failed to evaluate CEL expression "port + offset": Identifier "offset" not found
```

Solution: Ensure all variables used in expressions are defined in the schema.

## Advanced Patterns

### Feature Flags

```yaml
kind: TemplateDefinition
metadata:
  name: FeatureStack
schema:
  type: object
  properties:
    features:
      type: object
      properties:
        auth: { type: boolean, default: true }
        monitoring: { type: boolean, default: false }
        caching: { type: boolean, default: true }
resources:
  - if: 'features.auth'
    kind: Auth.Service
    # ...
  - if: 'features.monitoring'
    kind: Monitoring.Service
    # ...
  - if: 'features.caching'
    kind: Cache.Service
    # ...
```

### Environment-Specific Configuration

```yaml
kind: TemplateDefinition
metadata:
  name: EnvironmentStack
schema:
  type: object
  properties:
    environment:
      type: string
      default: 'development'
    config:
      type: object
      default:
        development:
          replicas: 1
          logLevel: 'debug'
        production:
          replicas: 5
          logLevel: 'info'
resources:
  - kind: App.Server
    metadata:
      name: 'app-${{ environment }}'
    replicas: ${{ config[environment].replicas }}
    logLevel: '${{ config[environment].logLevel }}'
```

### Dynamic Route Generation

```yaml
kind: TemplateDefinition
metadata:
  name: CrudApi
schema:
  type: object
  properties:
    resources:
      type: array
      items:
        type: string
      default: ['users', 'posts', 'comments']
resources:
  - kind: Http.Api
    metadata:
      name: 'crud-api'
    routes:
      - for:
          [
            'resource in resources',
            "method in ['GET', 'POST', 'PUT', 'DELETE']",
          ]
        path: '/api/${{ resource }}'
        method: '${{ method }}'
        handler: 'Logic.JavaScript.${{ method }}${{ resource }}'
```

This generates a complete CRUD API with GET, POST, PUT, and DELETE routes for each resource.

## Migration from Old Template Module

If you have existing templates using the old `Template.Template` syntax:

**Old syntax:**

```yaml
kind: Template.Template
parameters:
  - name: port
    type: integer
resources:
  - kind: Http.Server
    metadata:
      name: ${{ Template.parameters.port }}
```

**New syntax:**

```yaml
kind: TemplateDefinition
metadata:
  name: MyTemplate
schema:
  type: object
  properties:
    port:
      type: integer
      default: 8080
resources:
  - kind: Http.Server
    metadata:
      name: 'server'
    port: ${{ port }}
```

Key changes:
:
name: ${{ Template.parameters.port }}

````

**New syntax:**

```yaml
kind: TemplateDefinition
metadata:
  name: MyTemplate
schema:
  type: object
  properties:
    port:
      type: integer
      default: 8080
resources:
  - kind: Http.Server
    metadata:
      name: "server"
    port: ${{ port }}
````

Key changes:

1. `kind: Template.Template` → `kind: TemplateDefinition`
2. `parameters` array → `schema.properties` object (JSONSchema)
3. `${{ Template.parameters.name }}` → `${{ name }}`
4. Instantiation: Use `kind: Template.<TemplateName>`
