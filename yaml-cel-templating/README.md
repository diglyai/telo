Here is the full technical specification for the **CEL-YAML Templating Engine**.

---

# CEL-YAML Templating Specification (v1.0)

## 1. Core Principles

1. **Directives are Reserved:** All keys starting with `$` are engine instructions. All other keys are treated as data.
2. **Top-Down Evaluation:** The engine traverses the YAML tree from root to leaves.
3. **Scoped Environments:** Variables are stored in a stack. Child nodes inherit the parent's environment.
4. **Order of Operations:** In any YAML Mapping (object), directives are processed in a strict priority order:
5. `$let` (Context Expansion)
6. `$assert` (Validation)
7. `$if` (Conditional Logic)
8. `$for` (Iteration)
9. `$include` (Composition)
10. **Regular Keys** (Data Rendering)

---

## 2. Syntax & Interpolation

### 2.1. Inline Interpolation (`${...}`)

Any string value containing `${...}` is treated as a CEL expression.

- **Mixed String:** `"host-${region}"` Evaluates to String.
- **Exact Match:** `"${port}"` Evaluates to the type of the result (e.g., Integer `8080`, Boolean `true`), _unless_ part of a larger string.

### 2.2. Directives

Directives control the structural generation of the YAML. They consume the key they are defined in.

---

## 3. Directives Reference

### 3.1. Context Definition (`$let`)

Defines variables scoped to the **current object** (siblings) and **all descendants**.

- **Syntax:** Map of `variable_name: cel_expression`.
- **Behavior:** Evaluated before any other key in the same map.
- **Scope:** Variables defined here shadow global/parent variables of the same name.

```yaml
server:
  $let:
    cpu_request: '250m'
    is_prod: "env == 'production'"

  # Accessible by siblings
  resources:
    limits:
      cpu: ${cpu_request}

  # Accessible by children
  metadata:
    annotations:
      production: ${is_prod}
```

### 3.2. Conditionals (`$if` / `$then` / `$else`)

Conditionally includes or excludes a block.

- **Syntax:**
- `$if`: CEL expression (must evaluate to Boolean).
- `$then`: Object/Value to render if true.
- `$else`: (Optional) Object/Value to render if false.

- **Behavior:** The result of the block replaces the parent key's value.

```yaml
# Object Context
database:
  $if: 'enable_persistence'
  $then:
    type: 'postgres'
    storage: '100gi'
  $else:
    type: 'sqlite'
    storage: '0'
```

### 3.3. Iteration (`$for` / `$do`)

Generates lists or maps by iterating over a collection.

- **Syntax:**
- `$for`: String iterator format.
- List: `"item in list"`
- Map: `"key, val in map"`
- Range: `"i in range(5)"` (if `range()` function is provided in CEL env)

- `$do`: The template body to render for each iteration.

- **Behavior:**
- If used in a **List**, the results are appended/flattened into the parent list.
- If used in a **Map**, the results are merged into the parent map.

```yaml
# List Generation
ingress:
  - $for: "host in ['api', 'app', 'cdn']"
    $do:
      name: ${host}
      url: 'https://${host}.example.com'

# Map Key Generation
labels:
  $for: 'k, v in extra_tags'
  $do:
    'custom-${k}': ${v}
```

### 3.4. Modularity (`$include` / `$with`)

Loads and renders an external YAML file.

- **Syntax:**
- `$include`: File path string.
- `$with`: (Optional) Map of variables to inject into the included file's root scope.

- **Behavior:** The rendered result of the external file replaces the current node.

```yaml
service:
  $include: './templates/microservice.yaml'
  $with:
    name: 'user-auth'
    port: 8080
```

### 3.5. Validation (`$assert`)

Stops processing and returns an error if a condition is not met.

- **Syntax:**
- `$assert`: CEL expression (must evaluate to Boolean).
- `$msg`: (Optional) Error string.

```yaml
$assert: 'replicas <= 10'
$msg: 'You cannot request more than 10 replicas.'
```

### 3.6. Schema Definition (`$schema`)

Validates the structure and types of data inherited from the parent scope when used in the current scope and all descendants. Can be applied at any level (root or nested). Especially useful when manifest acts as a template imported with `$include`.

- **Syntax:** JSON Schema format where object schemas define keys as properties.
- **Scope:** Validates data from parent scope that flows into the current object and its descendants.
- **Behavior:** Type mismatches in data values are caught at parse time. The `$schema` does not validate variables defined in `$let` at the same scope—it validates data accessed from parent contexts.

```yaml
# Root-level schema validation - validates input context
$schema:
  env:
    type: string
  region:
    type: string
  services:
    type: array
    items:
      type: object
      properties:
        name:
          type: string
        ha:
          type: boolean

# Data from parent scope is type-checked
metadata:
  environment: ${env} # Type-checked: must be string per schema

# Nested schema validation - validates what parent scope provides
server:
  $schema:
    region:
      type: string
    env:
      type: string

  $let:
    cpu_request: '250m'
    is_prod: "env == 'production'"

  resources:
    # Parent scope data (region, env) is type-checked per nested schema
    location: ${region}
    limits:
      cpu: ${cpu_request} # Not type-checked: cpu_request is from local $let
```

- **Properties:**
  - `type`: Primitive types (`string`, `number`, `integer`, `boolean`, `array`, `object`).
  - `items`: For arrays, specifies the element schema.
  - `properties`: For objects, defines keyed sub-schemas.
  - `pattern`: Regex validation for string types.
  - `enum`: Allowed values.
  - `minimum`, `maximum`: Numeric bounds.

- **Type Checking:**
  - Data values accessed from parent scope via `${}` interpolations are type-checked against the schema.
  - Variables defined in `$let` at the same scope are not validated by the schema—they define their own types.
  - Violations produce clear compile-time errors with location information.

---

## 4. Full Example: "The Kitchen Sink"

This example demonstrates scope hierarchy, complex logic, and flat syntax.

**Input Context:**

```json
{
  "env": "prod",
  "region": "us-east-1",
  "services": [
    { "name": "cart", "ha": true },
    { "name": "catalog", "ha": false }
  ]
}
```

**Template:**

```yaml
# 1. Global Scope
$let:
  domain: 'acme.com'
  default_tags: { owner: 'platform', team: 'sre' }

apiVersion: v1
kind: List
items:
  # 2. Iteration
  - $for: 'svc in services'
    $do:
      # 3. Local Scope (shadows global if conflict)
      $let:
        full_name: '${svc.name}-${region}'
        is_ha: ${svc.ha && env == 'prod'}

      kind: Service
      metadata:
        name: ${full_name}
        labels:
          # 4. Map Iteration (merging into 'labels')
          $for: 'k, v in default_tags'
          $do:
            '${k}': ${v}

          # Explicit addition
          app: ${svc.name}

      spec:
        # 5. Conditional Logic
        $if: 'is_ha'
        $then:
          type: LoadBalancer
          replicas: 3
        $else:
          type: ClusterIP
          replicas: 1

        ports:
          - port: 80
            targetPort: 8080

  # 6. Include (Static Resource)
  - $include: 'common/monitoring-agent.yaml'
    $with:
      # Passes calculated variable from Global Scope
      cluster_domain: ${domain}
```
