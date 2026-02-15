# Voke Runtime

⚡ Voke
The open-source runtime for declarative backends.

Voke is a lightning-fast, plugin-driven execution engine (Micro-Kernel) that runs logic defined entirely in YAML manifests. Instead of writing imperative backend code, you define your routes, databases, schemas, and AI workflows as atomic, interconnected files. Voke takes those files and runs them.

Built to be language-agnostic and infinitely extensible, Voke is the open-source engine that powers DiglyAI.

🔮 The Meaning of Voke
A design manifest sitting on a hard drive is just a dead text file. It has potential, but no pulse.

The name Voke is derived from the Latin root vocare—to call, to invoke, to summon. That is exactly what this runtime does. It acts as the animating force for your architecture. You feed it a directory of static configurations, and Voke summons them into a living, breathing backend system—binding HTTP ports, opening database connection pools, and orchestrating complex workflows.

You write the spell. Voke casts it.

```bash
# Bring your manifests to life
$ voke ./manifest.yaml

🚀 Voke Kernel started
🔌 Loaded Modules: [HttpServer, Postgres, Workflow, AI]
📡 Listening on http://localhost:3000
```

## Why use Voke?

Zero Lock-in: Your entire backend is just standard YAML, JSON Schema ($ref), and CEL expressions.

Micro-Kernel Architecture: Voke itself knows nothing about HTTP or SQL. Everything is a plugin, meaning you only load exactly what you need.

Language Agnostic: Available as a Node.js runtime today, with a shared JSON runtime contract that allows for future Rust or Go implementations without changing your manifests.

## Example manifest

Here is an example Voke application that defines a simple HTTP API:

```yaml
kind: HttpServer.Server
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
path: /reference
apis:
  - Http.Api.HelloApi
info:
  title: Example API
  version: "${{ example.Version }}"
---
kind: Data.Type
metadata:
  name: HelloQuery
schema:
  properties:
    name:
      type: string
      default: "World"
  required: ["name"]
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
  required: ["greeting", "nice"]
---
kind: Http.Api
metadata:
  name: HelloApi
routes:
  - request:
      path: /hello
      method: GET
      query: "#/HelloQuery" # Reference to Data.Type
    handler:
      name: Logic.JavaScript.SayHello
      inputs:
        name: "${{ request.query.name }}" # CEL expression
    response:
      schema:
        body: "#/HelloResponse" # Reference to Data.Type
      status: 200
      body:
        greeting: "${{ result.message }}!"
        nice: "WOW"
---
kind: JavaScript.Script
name: SayHello
code: |
  function main({ name }) {
    return {
      message: `Hello ${name}!`,
    }
  };
inputSchema:
  name:
    type: string
outputSchema:
  message:
    type: string
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

This repository is an **early prototype** of the Voke runtime and specs. It is intended for exploration, feedback, and shaping the architecture rather than production use. The API surface - including YAML shapes - may change at any time without notice.

## Why

Modern platforms often spend disproportionate effort on technical mechanics-wiring frameworks, managing infrastructure, and negotiating toolchains-while the original business problem gets delayed or diluted. Voke Runtime pushes in the opposite direction: it treats runtime execution as a stable, predictable host so teams can concentrate on the **business logic and outcomes** instead of the plumbing.

By separating "what the system should do" from "how it is hosted", the runtime reduces friction for domain‑level changes. Teams can move faster on product requirements, experiment more safely, and keep conversations centered on value delivered rather than implementation trivia.

Voke also aims to **join forces across all programming language communities**, so the best ideas, patterns, and implementations can converge into a shared runtime truth without forcing everyone into a single stack.

YAML also makes the system more **AI‑friendly** than traditional programming languages: it is explicit, structured, and easier for tools to generate, review, and transform without losing intent.

## Modularity

Voke Runtime is built around **modules** that own specific resource kinds. A module is loaded from a manifest, declares which kinds it implements, and then receives only the resources of those kinds. This keeps concerns isolated and lets teams compose systems from focused building blocks rather than monolithic services.

At runtime, execution is always routed by **Kind.Name**. The kernel resolves the Kind to its owning module and hands off execution. Modules can call back into the kernel to execute other resources, enabling composition without tight coupling.

## Architecture

The architecture is inspired by Kubernetes-style manifests: declarative resources, explicit kinds, and a control plane that routes work based on those definitions.
Those manifest were taken to the next level by allowing them to run inside a standalone runtime host.

## Runtime Details

Implementation details, loading rules, and the runtime manifest specification live in `runtime/README.md`.

## See more at

- [Voke Runtime](./runtime/README.md)
- [Template System](./yaml-cel-templating//README.md)
- [Voke SDK for module authors](sdk/README.md)
- [Modules](modules/README.md)
  - [HttpServer](modules/http-server/README.md)

## License

See [LICENSE](./LICENSE).

## Contribution Note

By contributing, you agree that code and examples in this repository may be translated or re‑implemented in other programming languages (including by AI systems) to support the project’s polyglot goals.
