# DiglyAI Examples

This directory contains example modules and applications demonstrating DiglyAI features.

## Directory Structure

```
examples/
├── templates/          # TemplateDefinition examples
├── hello-api/          # Simple HTTP API example
└── README.md
```

## Template Examples (`templates/`)

### 1. `property-control-flow.yaml`

Demonstrates property-level control flow within resource definitions.

**Features shown:**

- Nested loops within property arrays (`for` combined with `for_inner`)
- Conditional middleware based on feature flags (`if`)
- Dynamic route generation from endpoint configurations
- Clean variable syntax: `${{ varName }}`

**Use case:** REST API with configurable endpoints and methods

### 2. `recursive-templates.yaml`

Shows recursive template composition where templates instantiate other templates.

**Features shown:**

- Base template (`HttpServer`) with parameterized configuration
- Higher-level template (`MultiRegionDeployment`) that uses the base template
- Loop iteration with index: `for: "region, index in regions"`
- Arithmetic in expressions: `${{ basePort + index }}`
- Multi-level template expansion

**Use case:** Multi-region deployment where each region gets its own configured server

### 3. `studio-api.yaml` (in modules/studio/)

The original example demonstrating API server generation with OpenAPI spec.

**Features shown:**

- Basic `for` loops over array of regions
- Conditional resource creation with `if: "enableOpenApi"`
- Resource reference arrays with loops
- JSONSchema with various types (string, integer, array, boolean)

**Use case:** API infrastructure with optional OpenAPI documentation

### 4. `comprehensive-template-demo.yaml`

Complete demonstration of all template system features in one file.

**Features shown:**

- All control flow patterns
- Complex CEL expressions
- Multiple instantiation examples
- Real-world use cases

**Use case:** Learning resource and reference implementation

## Hello API Example (`hello-api/`)

Simple HTTP API demonstrating basic DiglyAI application structure without templates.

## Running Examples

To use these examples with the DiglyAI runtime:

1. **Create a runtime manifest** that references the example:

```yaml
# runtime.yaml
name: 'example-runtime'
version: '1.0.0'
imports:
  - '@diglyai/digly-core'
resources:
  - 'examples/templates/recursive-templates.yaml'
```

2. **Run the runtime**:

```bash
cd runtime/nodejs
node bin/digly.js ../../runtime.yaml
```

The runtime will:

1. Load the TemplateDefinition resources
2. Detect template instances (resources with kind `Template.<Name>`)
3. Expand templates recursively, generating concrete resources
4. Register all generated resources in the registry
5. Start module execution

## Template Best Practices Demonstrated

### Clean Variable Syntax

```yaml
# ✅ Correct - direct access
name: "${{ serviceName }}-${{ region }}"

# ❌ Old syntax - don't use
name: "${{ self.parameters.serviceName }}-${{ self.parameters.region }}"
```

### Meaningful Defaults

```yaml
schema:
  type: object
  properties:
    port:
      type: integer
      default: 8080 # Sensible default
    regions:
      type: array
      items: { type: string }
      default: ['us-east', 'eu-west'] # Common regions
```

### Required vs Optional

```yaml
schema:
  type: object
  properties:
    name: { type: string } # Required for unique identification
    port: { type: integer, default: 8080 } # Optional with default
  required: [name]
```

### Unique Resource Names

```yaml
resources:
  - for: 'region in regions'
    kind: Http.Server
    metadata:
      name: '${{ serviceName }}-${{ region }}-server' # Unique per region
```

### Conditional Features

```yaml
resources:
  - if: 'has(monitoring) && monitoring.enabled'
    kind: Monitoring.Service
    # Only created when monitoring is explicitly enabled
```

## Advanced Patterns

### Multi-dimensional Loops

Generate resources from nested iterations:

```yaml
resources:
  - for: 'env in environments'
    for_inner: 'region in regions'
    kind: Http.Server
    metadata:
      name: '${{ serviceName }}-${{ env }}-${{ region }}'
```

### Dynamic Configuration Mapping

Use CEL expressions to select configuration based on context:

```yaml
schema:
  type: object
  properties:
    environment: { type: string, default: 'dev' }
    configs:
      type: object
      default:
        dev: { replicas: 1 }
        prod: { replicas: 5 }

resources:
  - kind: App.Service
    replicas: ${{ configs[environment].replicas }}
```

### Feature Flag Composition

Combine multiple boolean flags:

```yaml
resources:
  - if: 'enableAuth && enableMonitoring'
    kind: Security.AuditLogger
    # Only when both features are enabled
```

## Troubleshooting

### Template Not Found

**Error:** `Template "ApiServer" not found for instance "MyApi"`

**Solution:** Ensure the TemplateDefinition is loaded before the instance. Templates must be in the same or earlier loaded files.

### Invalid For Expression

**Error:** `Invalid 'for' expression: "x regions"`

**Solution:** Use correct syntax: `"item in collection"` or `"key, value in collection"`

### Recursion Limit Exceeded

**Error:** `Template expansion exceeded maximum depth of 10`

**Solution:** Check for circular references. Template A → Template B → Template A creates infinite recursion.

### Variable Not Found

**Error:** `CEL evaluation failed: Identifier "regionName" not found`

**Solution:** Verify the variable is defined in the template's schema or is a loop variable.

## Learn More

- [TEMPLATES.md](../runtime/TEMPLATES.md) - Comprehensive template system documentation
- [README.md](../runtime/README.md) - Runtime specification
- [SDK Documentation](../sdk/README.md) - Module development guide
