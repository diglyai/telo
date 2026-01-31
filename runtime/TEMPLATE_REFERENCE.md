# TemplateDefinition Quick Reference

## Basic Structure

```yaml
kind: TemplateDefinition
metadata:
  name: <TemplateName>
schema:
  type: object
  properties:
    <varName>:
      type: string|integer|boolean|array|object
      default: <value>
  required: [<varName>, ...]
resources:
  - <resource blueprint>
  - <resource blueprint>
  ...
```

## Variable Access

```yaml
# Direct access to schema variables
"${{ varName }}"
"${{ name }}-${{ region }}"
${{ port + 100 }}
```

## Control Flow: For Loops

```yaml
# Array iteration
- for: 'item in items'
  kind: Resource.Type
  value: '${{ item }}'

# Array with index
- for: 'index, item in items'
  kind: Resource.Type
  index: ${{ index }}
  value: '${{ item }}'

# Object/Map iteration
- for: 'key, value in map'
  kind: Resource.Type
  metadata:
    name: '${{ key }}'
  value: '${{ value }}'
```

## Control Flow: Conditionals

```yaml
# Simple condition
- if: "enableFeature"
  kind: Resource.Type
  ...

# Complex condition
- if: "has(config) && config.enabled"
  kind: Resource.Type
  ...

# Combining for and if
- for: "region in regions"
  if: "region != 'test'"
  kind: Resource.Type
  ...
```

## Property-Level Control Flow

```yaml
resources:
  - kind: Http.Api
    routes:
      - for: 'endpoint in endpoints'
        path: '/api/${{ endpoint }}'
        handler: 'Handler.${{ endpoint }}'
    middleware:
      - if: 'enableCors'
        kind: 'Cors'
```

## Template Instantiation

```yaml
kind: Template.<TemplateName>
metadata:
  name: <InstanceName>
<varName>: <value>
<varName>: <value>
...
```

## Recursive Templates

```yaml
# Template A
kind: TemplateDefinition
metadata:
  name: BaseTemplate
resources:
  - kind: Http.Server
    ...

---
# Template B (uses Template A)
kind: TemplateDefinition
metadata:
  name: CompositeTemplate
resources:
  - for: "region in regions"
    kind: Template.BaseTemplate
    metadata:
      name: "instance-${{ region }}"
    ...
```

## Common CEL Expressions

```yaml
# String concatenation
"${{ prefix }}-${{ suffix }}"

# Arithmetic
${{ basePort + index }}
${{ count * 2 }}

# Boolean logic
${{ enabled && verified }}
${{ !disabled }}

# Conditional (ternary)
${{ condition ? trueValue : falseValue }}

# Array/collection functions
${{ size(items) }}
${{ items.contains('value') }}

# Field existence
${{ has(optionalField) }}

# String operations
${{ name.startsWith('prod') }}
${{ path.endsWith('.yaml') }}
```

## JSONSchema Types

```yaml
# String
varName:
  type: string
  default: 'value'

# Integer
varName:
  type: integer
  default: 42

# Boolean
varName:
  type: boolean
  default: true

# Array
varName:
  type: array
  items:
    type: string
  default: ['a', 'b', 'c']

# Object
varName:
  type: object
  properties:
    key: { type: string }
  default:
    key: 'value'
```

## Best Practices

1. **Use meaningful defaults**

   ```yaml
   port: { type: integer, default: 8080 }
   ```

2. **Mark critical params as required**

   ```yaml
   required: [serviceName, region]
   ```

3. **Generate unique names**

   ```yaml
   metadata:
     name: '${{ service }}-${{ env }}-${{ region }}'
   ```

4. **Keep templates focused**
   - One template = one logical component
   - Use composition for complex scenarios

5. **Document with descriptions**
   ```yaml
   properties:
     replicas:
       type: integer
       default: 3
       description: 'Number of service replicas'
   ```

## Common Patterns

### Feature Flags

```yaml
- if: 'features.auth'
  kind: Auth.Service
- if: 'features.monitoring'
  kind: Monitoring.Agent
```

### Environment Config

```yaml
replicas: ${{ configs[environment].replicas }}
logLevel: '${{ configs[environment].logLevel }}'
```

### Multi-Region

```yaml
- for: 'region in regions'
  kind: Http.Server
  metadata:
    name: '${{ name }}-${{ region }}'
  region: '${{ region }}'
```

### CRUD Endpoints

```yaml
routes:
  - for: 'resource in resources'
    for_inner: "method in ['GET', 'POST', 'PUT', 'DELETE']"
    path: '/api/${{ resource }}'
    method: '${{ method }}'
```

## Error Messages

| Error                    | Solution                                                |
| ------------------------ | ------------------------------------------------------- |
| Template "X" not found   | Ensure TemplateDefinition exists before instance        |
| Invalid 'for' expression | Use: "item in collection" or "key, value in collection" |
| Maximum depth exceeded   | Check for circular template references                  |
| Identifier "X" not found | Verify variable is in schema or loop context            |
| Missing required 'kind'  | All resources must have 'kind' field                    |

## Limits

- **Max recursion depth**: 10 levels
- **Max expansion passes**: 10 iterations
- **Variables**: All schema properties are accessible
- **Loop syntax**: Standard CEL iteration

## See Also

- [TEMPLATES.md](../runtime/TEMPLATES.md) - Full documentation
- [examples/](../examples/) - Working examples
- [README.md](../runtime/README.md) - Runtime specification
