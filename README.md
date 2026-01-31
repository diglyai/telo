# DiglyAI Runtime

DiglyAI Runtime is a lightweight, execution host for DiglyAI applications. The runtime follows a **polyglot architecture**, with compatible implementations across languages.
It aims to provide a stable, predictable environment for running business logic defined in DiglyAI YAML manifests.

Planned languages:

- [x] NodeJS
- [ ] Rust
- [ ] Go
- [ ] Python

## Example

Here is an example DiglyAI application that defines a simple HTTP API:

```yaml
kind: Http.Server
metadata:
  name: ExampleServer
port: 8000
mounts:
  - path: /v1
    type: Http.Api.HelloApi
---
kind: OpenApi.Spec
metadata:
  name: HelloApiSpec
path: '/reference'
apis:
  - Http.Api.HelloApi
info:
  title: Example API
  version: '${{ example.Version }}'
---
kind: Data.Type
metadata:
  name: HelloQuery
schema:
  properties:
    name:
      type: string
      default: 'World'
  required: ['name']
  additionalProperties: false
---
kind: Data.Type
metadata:
  name: HelloResponse
schema:
  type: object
  properties:
    greeting:
      type: string
    nice:
      type: string
  required: ['greeting', 'nice']
---
kind: Http.Api
metadata:
  name: HelloApi
routes:
  - request:
      path: /hello
      method: GET
      query: '#/HelloQuery' # Reference to Data.Type
    handler:
      name: Logic.JavaScript.SayHello
      inputs:
        name: '${{ request.query.name }}' # CEL expression
    response:
      schema:
        body: '#/HelloResponse' # Reference to Data.Type
      status: 200
      body:
        greeting: '${{ result.message }}!'
        nice: 'WOW'
---
kind: Logic.JavaScript
name: SayHello
code: |
  function main({ name }) {
    return {
      message: `Hello ${name}!`,
    }
  };
inputSchema:
  type: object
  properties:
    name:
      type: string
  required: ['name']
outputSchema:
  type: object
  properties:
    message:
      type: string
  required: ['message']
```

## What It Does

- **Loads** resolved YAML resources into an immutable in‑memory registry.
- **Expands** TemplateDefinitions to dynamically generate resources with loops and conditionals.
- **Indexes** resources by Kind and Name for constant‑time lookup.
- **Dispatches** execution requests to the module that owns a Kind.

### Built-in Template System

The runtime includes a powerful template system for generating resources dynamically:

```yaml
# Define a template
kind: TemplateDefinition
metadata:
  name: ApiServer
schema:
  type: object
  properties:
    regions: { type: array, default: ['us-east', 'eu-west'] }
resources:
  - for: "region in regions"
    kind: Http.Server
    metadata:
      name: "api-${{ region }}"
    region: "${{ region }}"

# Instantiate it
kind: Template.ApiServer
metadata:
  name: ProductionApi
regions: ['us-east-1', 'us-west-2', 'eu-central-1']
```

See [TEMPLATES.md](./runtime/TEMPLATES.md) for comprehensive documentation.

## Status

This repository is an **early prototype** of the Digly runtime and specs. It is intended for exploration, feedback, and shaping the architecture rather than production use. The API surface - including YAML shapes - may change at any time without notice.

## Why

Modern platforms often spend disproportionate effort on technical mechanics-wiring frameworks, managing infrastructure, and negotiating toolchains-while the original business problem gets delayed or diluted. Digly Runtime pushes in the opposite direction: it treats runtime execution as a stable, predictable host so teams can concentrate on the **business logic and outcomes** instead of the plumbing.

By separating "what the system should do" from "how it is hosted", the runtime reduces friction for domain‑level changes. Teams can move faster on product requirements, experiment more safely, and keep conversations centered on value delivered rather than implementation trivia.

DiglyAI also aims to **join forces across all programming language communities**, so the best ideas, patterns, and implementations can converge into a shared runtime truth without forcing everyone into a single stack.

YAML also makes the system more **AI‑friendly** than traditional programming languages: it is explicit, structured, and easier for tools to generate, review, and transform without losing intent.

## Modularity

Digly Runtime is built around **modules** that own specific resource kinds. A module is loaded from a manifest, declares which kinds it implements, and then receives only the resources of those kinds. This keeps concerns isolated and lets teams compose systems from focused building blocks rather than monolithic services.

At runtime, execution is always routed by **Kind.Name**. The kernel resolves the Kind to its owning module and hands off execution. Modules can call back into the kernel to execute other resources, enabling composition without tight coupling.

## Architecture

The architecture is inspired by Kubernetes-style manifests: declarative resources, explicit kinds, and a control plane that routes work based on those definitions.
Those manifest were taken to the next level by allowing them to run inside a standalone runtime host.

## Runtime Details

Implementation details, loading rules, and the runtime manifest specification live in `runtime/README.md`.

## See more at

- [DiglyAI Runtime](./runtime/README.md)
- [Template System](./runtime/TEMPLATES.md)
- [Template Examples](./examples/templates/README.md)
- [DiglyAI SDK for module authors](sdk/README.md)
- [Modules](modules/README.md)
  - [Core](modules/core/README.md)

## License

See [LICENSE](./LICENSE).

## Contribution Note

By contributing, you agree that code and examples in this repository may be translated or re‑implemented in other programming languages (including by AI systems) to support the project’s polyglot goals.
