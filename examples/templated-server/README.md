# Template Examples

This directory contains examples demonstrating the DiglyAI TemplateDefinition system.

## Quick Start

Run the template examples:

```bash
# From the repository root
cd runtime/nodejs
node bin/digly.js ../../examples/templates/module.yaml
```

This will start 3 HTTP servers (ports 9000-9002) generated from a single template.

**Test the servers:**

```bash
# Test region us-east-1 (port 9000)
curl http://localhost:9000/health
curl http://localhost:9000/info

# Test region us-west-2 (port 9001)
curl http://localhost:9001/health
curl http://localhost:9001/info

# Test region eu-central-1 (port 9002)
curl http://localhost:9002/health
curl http://localhost:9002/info
```

Each server will return region-specific information, all generated from a single template!

## Files

### `simple-server-demo.yaml` ⭐ START HERE

Simple HTTP server template demonstrating the core templating features.

**What it demonstrates:**

- Loop-based server generation (`for: "index, region in regions"`)
- Dynamic port assignment (`${{ basePort + index }}`)
- Per-region handlers with template variables
- Clean, practical use case

**Generated resources:**

- 3 HTTP servers (one per region)
- 6 inline functions (health check + info per region)

---

### `template-basic-tests.yaml`

Basic template functionality tests covering fundamental features.

**What it demonstrates:**

- Simple variable expansion
- Array iteration with `for` loops
- Conditional resource creation with `if`
- Multiple template definitions in one file
- Template instantiation

**Best for:** Understanding the basics and testing core functionality.

---

### `property-control-flow.yaml`

Property-level control flow within resource definitions.

**What it demonstrates:**

- Nested loops within property arrays (`for` + `for_inner`)
- Conditional middleware based on feature flags
- Dynamic route generation from endpoint configurations
- Clean variable syntax: `${{ varName }}`

**Best for:** Learning how to use loops and conditionals within resource properties.

---

### `recursive-templates.yaml`

Recursive template composition where templates instantiate other templates.

**What it demonstrates:**

- Base template with parameterized configuration
- Higher-level template that uses the base template
- Loop iteration with index: `for: "region, index in regions"`
- Arithmetic in expressions: `${{ basePort + index }}`
- Multi-level template expansion

**Best for:** Understanding template composition and recursion.

---

### `comprehensive-template-demo.yaml`

Complete demonstration of all template system features.

**What it demonstrates:**

- All control flow patterns (for, if, nested loops)
- Complex CEL expressions
- Feature flags and environment-specific configuration
- Multiple real-world use cases
- Various instantiation patterns

**Best for:** Reference implementation and learning advanced patterns.

## Running Different Examples

Edit `module.yaml` to uncomment the examples you want to run:

```yaml
resources:
  - 'simple-server-demo.yaml'        # Default - 3 HTTP servers
  # - 'template-basic-tests.yaml'    # Uncomment to add basic tests
  # - 'property-control-flow.yaml'   # Uncomment for property examples
```

Then run:

```bash
cd runtime/nodejs
node bin/digly.js ../../examples/templates/module.yaml
```

## What Gets Generated

When you run `simple-server-demo.yaml`, the template system expands:

**Input (1 template + 1 instance):**

```yaml
kind: TemplateDefinition
metadata:
  name: RegionalServer
# ... schema and resources ...

kind: Template.RegionalServer
regions: ['us-east-1', 'us-west-2', 'eu-central-1']
```

**Output (9 concrete resources):**

- `Http.Server.api-gateway-us-east-1` (port 9000)
- `Http.Server.api-gateway-us-west-2` (port 9001)
- `Http.Server.api-gateway-eu-central-1` (port 9002)
- `Logic.InlineFunction.HealthCheck-us-east-1`
- `Logic.InlineFunction.HealthCheck-us-west-2`
- `Logic.InlineFunction.HealthCheck-eu-central-1`
- `Logic.InlineFunction.Info-us-east-1`
- `Logic.InlineFunction.Info-us-west-2`
- `Logic.InlineFunction.Info-eu-central-1`

All from a single template definition!

## Learning Path

1. **Start here:** `simple-server-demo.yaml`
   - Run it and test the generated servers
   - See real resources generated from a template
   - Understand loop iteration with index

2. **Next:** `template-basic-tests.yaml`
   - Understand variable expansion
   - Learn basic loops and conditionals
   - See multiple template patterns

3. **Then:** `property-control-flow.yaml`
   - See how control flow works in properties
   - Learn nested loop patterns

4. **Then:** `recursive-templates.yaml`
   - Understand template composition
   - Learn how templates can use other templates

5. **Finally:** `comprehensive-template-demo.yaml`
   - See all features combined
   - Study real-world patterns

## Common Patterns

### Loop Over Array

```yaml
- for: "item in items"
  kind: Resource.Type
  value: "${{ item }}"
```

### Loop with Index

```yaml
- for: "index, item in items"
  kind: Resource.Type
  index: ${{ index }}
  value: "${{ item }}"
```

### Conditional Resource

```yaml
- if: "enableFeature"
  kind: Feature.Service
```

### Nested Loops

```yaml
- for: "env in environments"
  for_inner: "region in env.regions"
  kind: Http.Server
  name: "${{ env }}-${{ region }}"
```

## Documentation

- [TEMPLATES.md](../../runtime/TEMPLATES.md) - Comprehensive guide
- [TEMPLATE_REFERENCE.md](../../runtime/TEMPLATE_REFERENCE.md) - Quick reference
- [README.md](../../runtime/README.md) - Runtime specification

## Troubleshooting

**Template not found:**

- Ensure TemplateDefinition is defined before instantiation
- Check the template name matches exactly

**Variable not found:**

- Verify variable is defined in schema
- Check spelling and case sensitivity

**Recursion limit:**

- Check for circular template references
- Simplify template composition if needed

**Invalid for expression:**

- Use correct syntax: `"item in collection"`
- For indexed iteration: `"index, item in collection"`
