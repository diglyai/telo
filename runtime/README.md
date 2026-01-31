# Digly Runtime Specification v1.0

**Status:** Draft

**Target:** Polyglot Implementation (Node.js, Rust, Go)

**Input:** Resolved Distribution Directory

**Status:** Early prototype (spec and runtime are evolving; not production‑ready). The API surface - including YAML shapes - may change at any time without notice.

## 1. Core Concepts

The Digly Runtime is a **Read-Only Execution Host**. It is designed with the assumption that a "Linker" has already performed schema validation, ID resolution, and dependency flattening. The runtime follows a **polyglot architecture**, enabling compatible implementations in multiple languages.

The Runtime performs four specific functions:

- **Loader:** Ingests resolved YAML resources from disk into an immutable memory state.
- **Template Expander:** Dynamically generates resources from TemplateDefinition blueprints with control flow (for/if).
- **Registry:** Indexes resources by a composite key of Kind and Name.
- **Router:** A synchronous dispatcher that routes execution requests between Modules based on URNs.

**See [TEMPLATES.md](./TEMPLATES.md) for comprehensive template system documentation.**

## 2. Input Format (The Distribution)

The Runtime consumes a directory containing YAML files or a single YAML file.

**Strict typing requirement:** YAML is intended to be strictly typed. The runtime must validate all manifests and resources before execution and **fail fast** if anything is invalid or inconsistent.

### 2.1 File System Structure

- Files may be nested in subdirectories for organization, but the Runtime treats the namespace as flat based on resource metadata.
- **Multiple Documents:** A single file may contain multiple resources separated by `---`.
- **Entrypoint Manifest:** `runtime.yaml` is the chosen entrypoint manifest filename. It is not reserved by the format, and any YAML file can serve as a module or resource manifest depending on how it is referenced.

### 2.2 Resource Object Model

Every YAML document must deserialize into the following structure:

```typescript
interface RuntimeResource {
  kind: string; // e.g., "Http.Route", "Logic.JavaScript", "Workflow.Step"
  metadata: {
    name: string; // Unique identifier within the Kind
    [key: string]: any; // Optional labels or annotations
  };
  // All configuration fields are flat at the top level.
  // Resource kinds should define their own top-level fields (e.g., "routes", "port", "mounts").
  // A "spec" field from kubernetes is not used by the runtime and should be avoided for clarity.
  [key: string]: any;
}
```

## 3. Reference Standards

All pointers must be pre-resolved into Uniform Resource Names (URNs).

### 3.1 The URN Format

- **Format:** `Kind.Name` (Case-sensitive). `Kind` can include dots (e.g., `Http.Server`).
- **Source Logic:** `type: Logic.JavaScript.GetUsers`
- **Source Data:** Runtime: `type: "http://${{ Secret.Host }}"`

### 3.2 Reference Types

- **Logic References:** Used in fields that trigger execution (e.g., `handler: "Logic.JavaScript.Insert"`).
- **Data References:** Used for structural lookups (e.g., `target: "Data.Type.Product"`).
- **Expressions (CEL):** Injected into strings. The CEL evaluator must resolve module/kind segments as nested namespaces (e.g., `${{ Http.Server.Example.port }}`).

## 4. Kernel Architecture

The Kernel is the central orchestrator. It manages the lifecycle and the message bus.

### 4.1 Kernel Interface

```typescript
interface Kernel {
  registry: Map<string, Map<string, RuntimeResource>>; // Kind -> Name -> Resource
  modules: Map<string, DiglyModule>; // Kind -> Module

  load(path: string): Promise<void>; // Ingest files
  register(module: DiglyModule): void; // Attach drivers
  start(): Promise<void>; // Boot sequence
  execute(urn: string, input: any, ctx: Context): Promise<any>; // Dispatcher
}
```

### 4.2 Boot Sequence (Strict Order)

1. **load(path):**
   - Recursively walk the directory.
   - Parse YAML documents.
   - Order resources so that any resource whose `metadata.name` defines a Kind used by another resource is loaded first.
   - Cyclic Kind dependencies must cause startup failure.
   - **CRITICAL:** If `registry[Kind][Name]` already exists, the Kernel must panic and exit (Duplicate Resource Error).

2. **register(module):**
   - Maps the module to its claimed `resourceKinds`.
   - Filters the registry for all resources matching those Kinds.
   - Calls `module.onLoad(resources)`.

3. **start():**
   - Calls `module.onStart(ctx)` for all modules.
   - Modules initialize I/O (e.g., HttpModule starts listening on a port).
   - Startup fails if any resource Kind has no registered module.

## 5. Module Entry Point

Modules export a single `register` function and may export a `create` function for per-resource instances.

```typescript
export function register(ctx: ModuleContext): void | Promise<void>;
export function create(
  resource: RuntimeResource,
  ctx: ModuleCreateContext,
): ResourceInstance | null | Promise<ResourceInstance | null>;
```

`create()` is called once per resource the module handles. The returned `ResourceInstance` may define:

```typescript
interface ResourceInstance {
  init?(): void | Promise<void>;
  teardown?(): void | Promise<void>;
}
```

```typescript
interface ModuleCreateContext extends ModuleContext {
  kernel: {
    registry: Map<string, Map<string, RuntimeResource>>;
    execute(urn: string, input: any, ctx?: any): Promise<any>;
  };
  getResources(kind: string): RuntimeResource[];
  onResourceEvent(
    kind: string,
    name: string,
    event: string,
    handler: (payload?: any) => void | Promise<void>,
  ): void;
  onceResourceEvent(
    kind: string,
    name: string,
    event: string,
    handler: (payload?: any) => void | Promise<void>,
  ): void;
  offResourceEvent(
    kind: string,
    name: string,
    event: string,
    handler: (payload?: any) => void | Promise<void>,
  ): void;
  emitResourceEvent(
    kind: string,
    name: string,
    event: string,
    payload?: any,
  ): Promise<void>;
}
```

## 6. Execution Model (The Request Loop)

The Kernel acts as a **Synchronous Dispatcher**. It does not understand "SQL" or "HTTP"; it only understands "Who handles this Kind?".

### 6.1 The Dispatch Cycle

1. **Request:** A Module or External Trigger calls `kernel.execute("Kind.Name", payload)`.
2. **Lookup:** Kernel splits URN on the last dot. Finds Module associated with Kind.
3. **Handoff:** Kernel calls `module.execute("Name", payload, context)`.
4. **Recursion:** If the Module needs to trigger another resource, it calls `context.execute()` (back to the Kernel).

## 7. Error Handling Standards

Implementations must use these standard error codes:

- **ERR_RESOURCE_NOT_FOUND:** The URN `Kind.Name` does not exist in the Registry.
- **ERR_MODULE_MISSING:** The Kind exists in the Registry, but no Module has claimed it.
- **ERR_DUPLICATE_RESOURCE:** Two resources share the same Kind/Name during Load.
- **ERR_EXECUTION_FAILED:** The Module encountered a runtime error during execute.

## 8. Runtime Events

Events are namespaced as `<Module>.<Event>`.

Runtime emits:

- `Runtime.Starting`
- `Runtime.Started`
- `Runtime.Blocked`
- `Runtime.Unblocked`
- `Runtime.Stopping`
- `Runtime.Stopped`

Modules can emit their own events via `ctx.emit("Module.Event", payload)` (if no dot is present, the module name is prefixed automatically).

Resource-scoped events use `<Kind>.<Event>`:

- `<Kind>.Initialized`
- `<Kind>.Teardown`

Custom resource triggers are emitted via `emitResourceEvent(kind, name, event, payload)`.
`Initialized` and `Teardown` are reserved and cannot be emitted by modules.

### 8.1 Runtime Holds (Keepalive Leases)

The runtime stays alive while one or more holds are active. Modules and resources can
acquire a hold when they start long-lived work (HTTP servers, queues, watchers) and
release it during teardown. When the hold count transitions from 0 to 1, the runtime
emits `Runtime.Blocked`. When it returns to 0, the runtime emits `Runtime.Unblocked`
and the host exits after running shutdown hooks.

## 12. Summary for Implementers

- **Stateless Logic:** The Kernel should be stateless. All execution state must live in the Context passed through the stack.
- **Kind Isolation:** A Module owning Kind A cannot access the spec of Kind B except via a `kernel.execute` call.
- **Schema-Agnostic Runtime:** The Kernel does not interpret schema fields; validation is a module concern.
- **Module Manifests:** Modules define their capabilities through `module.yaml` manifests with resource definition files.
- **Module Imports:** Modules can import other modules, with each imported module registered separately in the kernel.
- **Keepalive Holds:** The runtime remains alive while at least one module or resource holds a runtime lease. When the hold count reaches zero, the runtime emits `Runtime.Stopping`/`Runtime.Stopped` and exits.

## 13. Runtime Kind Inheritance

The runtime supports creating new kinds at runtime that inherit behavior from existing kinds using the built-in `Runtime.KindDefinition` resource.

### 13.1 KindDefinition Resource

`Runtime.KindDefinition` is a special built-in resource kind handled directly by the Kernel (no module required):

```yaml
kind: Runtime.KindDefinition
metadata:
  name: Data.ObjectType # Name of the new kind being created
extends: Data.Type # Parent kind to inherit controller from
schema: # Optional: Schema for the new kind
  type: object
  additionalProperties: true
```

### 13.2 Inheritance Behavior

When a `Runtime.KindDefinition` resource is registered:

1. The Kernel tracks the inheritance relationship: `Data.ObjectType extends Data.Type`
2. During module resolution, if no module handles `Data.ObjectType`, the Kernel automatically assigns the module that handles `Data.Type`
3. This works recursively - kinds can extend other extended kinds

### 13.3 Use Cases

- Creating domain-specific data types without writing controllers
- Extending framework kinds with custom semantics
- Runtime schema validation for specialized resource types

### 13.4 Example

```yaml
# Module defines Data.Type
kind: ResourceDefinition
metadata:
  name: DataTypeDefinition
  resourceKind: Type
controllers:
  - runtime: 'node@>=20'
    entrypoint: './data-controller.ts'
schema:
  type: object
  # ...

---
# Application creates Data.ObjectType extending Data.Type
kind: Runtime.KindDefinition
metadata:
  name: Data.ObjectType
extends: Data.Type
schema:
  type: object
  additionalProperties: true

---
# Now Data.ObjectType can be used like Data.Type
kind: Data.ObjectType
metadata:
  name: UserProfile
schema:
  type: object
  properties:
    name:
      type: string
```

## 14. Built-in TemplateDefinition

The runtime includes a built-in `TemplateDefinition` resource kind that enables dynamic resource generation through declarative templates with CEL-based control flow. Templates support loops (`for`), conditionals (`if`), variable expansion, and recursive composition.

**For comprehensive documentation, see [TEMPLATES.md](./TEMPLATES.md).**

### 14.1 Basic Template Structure

```yaml
kind: TemplateDefinition
metadata:
  name: ApiServer
schema:
  type: object
  properties:
    name: { type: string, default: 'api' }
    port: { type: integer, default: 8080 }
    regions:
      type: array
      items: { type: string }
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

### 14.2 Template Instantiation

Templates are instantiated using the kind `YourModule.<TemplateName>`:

```yaml
kind: YourModule.ApiServer
metadata:
  name: ProductionApi
name: 'production'
port: 3000
regions: ['us-east-1', 'us-west-2', 'eu-central-1']
```

This generates 3 `Http.Server` resources at load time.

### 14.3 Key Features

- **Clean variable syntax**: `${{ varName }}` (no namespace prefix required)
- **JSONSchema-based parameters**: Type-safe with defaults and validation
- **Control flow directives**: `for` (loops) and `if` (conditionals)
- **Recursive expansion**: Templates can instantiate other templates (up to 10 levels)
- **Property-level expansion**: Control flow works within resource properties

### 14.4 Template Expansion Pipeline

1. **Load Phase**: Loader ingests all resources, including TemplateDefinitions
2. **Instantiation Detection**: Resources with kind `YourModule.<Name>` are identified
3. **Recursive Expansion**: Template instances are expanded, generating concrete resources
4. **Registry Registration**: Generated resources are added to the registry
5. **Expression Resolution**: Standard CEL expression resolution continues

## 9. Module Distribution & Loading

The Runtime supports two methods of loading modules to maintain polyglot compatibility.

### 9.1 Static/Built-in Modules

Modules compiled directly into the Runtime binary. These are registered manually in the Runtime's entry point before kernel.load() is called.

### 9.2 Dynamic External Modules

Modules loaded at runtime based on the runtime.yaml entrypoint module.

Runtime Environment

Loading Mechanism

Node.js

require() or import() from a local path or node_modules.

Go

Go dynamic module package (.so files) or RPC-based HashiCorp modules.

Rust

libloading (Dynamic libraries) or WebAssembly (Wasmtime/WasmEdge).

## 10. Module Manifest System

Modules can define their capabilities using a `module.yaml` manifest file that describes their definitions and dependencies.

### 10.1 Module Manifest Structure

```yaml
name: 'core' # Module identifier
version: '1.0.0' # Module version
imports: # Optional: Import other modules
  - './http' # Relative path to imported module
definitions: # Resource definition files
  - 'definitions/application.yaml'
  - 'definitions/variable.yaml'
entrypoints: # Optional: Entrypoints per runtime
  - runtime: 'node@>=20 <23'
    entrypoint: './index.ts'
  - runtime: 'bun@>=1.1'
    entrypoint: './index.ts'
importEntrypoints: # Optional: Override entrypoints for imports
  './http':
    - runtime: 'node@>=20 <23'
      entrypoint: './index.ts'
  './http-rust':
    - runtime: 'rust@>=1.76'
      entrypoint: './module.wasm'
```

### 10.2 Resource Definitions

Each module can define the kinds of resources it handles using ResourceDefinition files:

```typescript
interface ResourceDefinition {
  kind: 'ResourceDefinition';
  metadata: {
    name: string; // Definition name
    resourceKind: string; // The local Kind this module handles (runtime scopes to ModuleName.Kind)
  };
  schema: Record<string, any>; // JSON Schema for validation
  events?: string[]; // Optional: discoverable custom events
}
```

### 10.3 Per-Kind Controllers

Definitions can map a Kind to per-runtime controllers:

```yaml
definitions:
  - path: 'definitions/logic.yaml'
    controllers:
      - runtime: 'node@>=20 <23'
        entrypoint: './controllers/logic.ts'
      - runtime: 'bun@>=1.1'
        entrypoint: './controllers/logic.ts'
  - path: 'definitions/javascript.yaml'
    controllers:
      - runtime: 'node@>=20 <23'
        entrypoint: './controllers/javascript.ts'
```

Controllers may export any of:

```typescript
export function register(ctx: ModuleContext): void | Promise<void>;
export function create(
  resource: RuntimeResource,
  ctx: ModuleCreateContext,
): ResourceInstance | null | Promise<ResourceInstance | null>;
export function execute(name: string, input: any, ctx: any): Promise<any>;
```

When a controller is defined for a Kind, it is used instead of the module-level entrypoint for that Kind.

### 10.4 Module Discovery and Import

The Runtime supports module imports, allowing modules to depend on other modules:

```typescript
interface ModuleDiscoveryResult {
  mainModule: {
    manifest: ModuleManifest;
    resourceDefinitions: ResourceDefinition[];
  };
  importedModules: Array<{
    path: string;
    manifest: ModuleManifest;
    resourceDefinitions: ResourceDefinition[];
  }>;
}
```

When a module imports another module, both are registered separately in the kernel, maintaining isolation between their resource kinds and execution contexts.

## 11. The Runtime Manifest (runtime.yaml)

The runtime.yaml file is the entrypoint module manifest used by the Kernel.

### Example runtime.yaml

```yaml
name: 'example'
version: '1.0.0'
imports:
  - '@diglyai/digly-core' # NPM package or local path
resources:
  - 'path/to/first-manifest.yaml'
  - 'path/to/directory'
  - 'https://example.com/remote-manifest.yaml'
  - '${{ env.MY_MANIFEST_PATH }}' # Environment variable support via CEL expressions inside brackets
```

**Source Resolution:** The Runtime implementation maps the import strings to its local loader (e.g., npm install path for Node, dlopen for C/Rust).

**Manifest Loading:** Each module manifest (including `runtime.yaml`) is loaded to determine its resource kinds and dependencies.

**Resources Loading:** The runtime `resources` list is loaded into the registry before modules are started.
