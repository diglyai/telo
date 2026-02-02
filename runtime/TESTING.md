# Testing with Pipeline Jobs

Tests in DiglyAI use `Pipeline.Job` resources to orchestrate execution and verify outputs. Everything is inline—no separate resource definitions.

## Quick Start

### Example: Simple Test

```yaml
kind: Pipeline.Job
metadata:
  name: TestAdd

steps:
  - name: Add numbers
    kind: Logic.JavaScript
    code: |
      function main({ a, b }) {
        return { result: a + b }
      }
    input:
      a: 5
      b: 3
    outputs:
      result: 'payload.result'

  - name: Assert result
    kind: Assert.Value
    value: '${{ result }}'
    assertions:
      - 'value == 8'
      - "typeof(value) == 'number'"
```

Run it:

```bash
# Via kernel
kernel.execute("Pipeline.Job.TestAdd", {})

# Or search for tests
grep -r "kind: Pipeline.Job" .
```

## Step Types

### Direct Resource Steps

Any resource kind can be a step. Define the resource inline:

```yaml
- name: Execute logic
  kind: Logic.JavaScript
  code: |
    function main({ input }) {
      return { result: input * 2 }
    }
  input:
    input: 21
  outputs:
    result: 'payload.result'
```

### HttpClient.Request

Make HTTP requests:

```yaml
- name: Call API
  kind: HttpClient.Request
  method: POST
  url: 'http://localhost:3000/api/users'
  headers:
    Content-Type: application/json
    Authorization: 'Bearer token'
  body:
    name: Alice
    email: alice@example.com
  outputs:
    userId: 'payload.id'
    createdAt: 'payload.created_at'
```

### Observe.Event

Wait for and capture async events:

```yaml
- name: Wait for processing complete
  kind: Observe.Event
  event: ProcessingCompleted
  timeout: 5000
  filter: 'data.jobId == jobId'
  outputs:
    result: 'data.result'
    processingTime: 'data.duration'
```

### Assert.Value

Verify values using CEL expressions:

```yaml
- name: Verify result
  kind: Assert.Value
  value: '${{ previousStepOutput }}'
  assertions:
    - 'value > 100'
    - 'value < 1000'
```

## Accessing Previous Step Outputs

Outputs from earlier steps are available via `${{ varName }}`:

```yaml
steps:
  - name: Get user
    kind: Logic.JavaScript
    code: |
      function main({ userId }) {
        return { user: { id: userId, name: 'Alice' } }
      }
    input:
      userId: 42
    outputs:
      user: 'payload.user'

  - name: Get user email
    kind: Logic.JavaScript
    code: |
      function main({ name }) {
        return { email: name.toLowerCase() + '@example.com' }
      }
    input:
      name: '${{ user.name }}'
    outputs:
      email: 'payload.email'

  - name: Send notification
    kind: HttpClient.Request
    method: POST
    url: 'http://api/notify'
    body:
      userId: '${{ user.id }}'
      email: '${{ email }}'

  - name: Verify email
    kind: Assert.Value
    value: '${{ email }}'
    assertions:
      - 'value != null'
      - "value contains '@'"
```

## Assertions

Assertions are CEL expressions in `Assert.Value` steps. The `value` variable contains what's being tested:

```yaml
assertions:
  - 'value != null'
  - "typeof(value) == 'object'"
  - "value.status == 'ok'"
  - 'value.count > 0'
  - "value.name contains 'test'"
  - 'value in [1, 2, 3]'
```

### Common Patterns

```yaml
# Check presence and type
- "value != null && typeof(value) == 'object'"

# Numeric comparisons
- 'value >= 0 && value <= 100'

# String operations
- "value.startsWith('Error')"
- "value.endsWith('.json')"

# Collection operations
- 'value.size() == 3'
- 'value.map(x, x.id).contains(42)'
```

## Complete Example

```yaml
kind: Pipeline.Job
metadata:
  name: TestCalculator
  description: Verify calculator logic works correctly

steps:
  - name: Test addition
    kind: Logic.JavaScript
    code: |
      function main({ a, b, operation }) {
        if (operation == 'add') return { result: a + b }
        if (operation == 'multiply') return { result: a * b }
        throw new Error('Unknown operation')
      }
    input:
      a: 5
      b: 3
      operation: add
    outputs:
      sum: 'payload.result'

  - name: Assert addition
    kind: Assert.Value
    value: '${{ sum }}'
    assertions:
      - 'value == 8'

  - name: Test multiplication
    kind: Logic.JavaScript
    code: |
      function main({ a, b, operation }) {
        if (operation == 'add') return { result: a + b }
        if (operation == 'multiply') return { result: a * b }
        throw new Error('Unknown operation')
      }
    input:
      a: 5
      b: 3
      operation: multiply
    outputs:
      product: 'payload.result'

  - name: Assert multiplication
    kind: Assert.Value
    value: '${{ product }}'
    assertions:
      - 'value == 15'

  - name: Call API
    kind: HttpClient.Request
    method: POST
    url: 'http://localhost:3001/calculate'
    body:
      a: 4
      b: 7
    outputs:
      apiResult: 'payload.result'

  - name: Assert API result
    kind: Assert.Value
    value: '${{ apiResult }}'
    assertions:
      - 'value == 28'

## Testing Guidelines

1. **Keep steps focused**: One action per step
2. **Use descriptive names**: Step names should explain what's happening
3. **Extract relevant outputs**: Only capture data needed for assertions
4. **Separate logic and assertions**: Keep execution steps separate from verification
5. **Test edge cases**: Empty inputs, null values, boundary conditions
6. **Everything inline**: Define all logic and resources in the Pipeline.Job itself

## Debugging

### View Step Execution

Run the Pipeline.Job to see step outputs:

```bash
kernel.execute("Pipeline.Job.TestCalculator", {})
```

### Common Issues

**Variable not found**: Check JSONPath in `outputs` matches your response structure
**Assertion failed**: Verify CEL expression is correct for the value type
**Unknown resource**: Ensure `kind` and required fields are properly defined inline

## See Also

- [Examples](../examples/) - Complete working test examples
- [Runtime Documentation](../runtime/README.md) - How DiglyAI runtime works
- [Module Documentation](../modules/README.md) - Module structure and resources
