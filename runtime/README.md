# Digly Runtime Specification v1.0

**Status:** Draft

**Target:** Polyglot Implementation (Node.js, Rust, Go)

**Input:** Resolved Distribution Directory

**Status:** Early prototype (spec and runtime are evolving; not production‑ready). The API surface - including YAML shapes - may change at any time without notice.

## 1. Core Concepts

The Digly Runtime is a **Read-Only Execution Host**. It is designed with the assumption that a "Loader" (or "Linker") has already performed schema validation, ID resolution, module discovery, and resource loading. The runtime follows a **polyglot architecture**, enabling compatible implementations in multiple languages.

The Runtime performs three specific functions:

- **Template Expander:** Dynamically generates resources from TemplateDefinition blueprints with control flow (for/if).
- **Registry:** Indexes resources by a composite key of Kind and Name.
- **Router:** A synchronous dispatcher that routes execution requests based on URNs.

**Module Loading and Resource Discovery:** These are responsibilities of the Loader, not the Runtime. The Loader prepares modules and resources before handing them to the Runtime.

**See [TEMPLATES.md](./TEMPLATES.md) for comprehensive template system documentation.**

## 2. Input Format

The Runtime receives pre-loaded resources and modules from the Loader. Resources are already validated and indexed.

### 2.1 Resource Format

- The Runtime does not load files directly; the Loader handles file I/O and validation.
- Resources are provided as in-memory objects, already validated against their schemas.
- **Multiple Formats Supported:** Resources may come from files, templates, or dynamically-generated sources.

### 2.2 Resource Object Model

Every YAML document must deserialize into the following structure:

```typescript
interface RuntimeResource {
  kind: string; // e.g., "Http.Route", "Logic.JavaScript", "Workflow.Step"
  metadata: {
    name: string; // Unique identifier within the Kind
    [key: string]: any; // Custom labels or annotations
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
- **Expressions (CEL):** Injected into strings. The CEL evaluator must resolve kind/resource segments as nested namespaces (e.g., `${{ Http.Server.Example.port }}`).

### 3.3 Resource URIs

Every resource has an optional `metadata.uri` field that provides an absolute, standard URI identifying where the resource came from and its lineage through template generations.

#### 3.3.1 URI Format

```
scheme://host/path#fragment
```

Where:

- **scheme:** Standard URI scheme: `file`, `http`, `https`, or others
- **host:** Authority (e.g., `localhost` for templates, domain name for remote resources)
- **path:** Resource location path
- **fragment:** Resource identifier chain in the form `kind.name[/kind.child/kind.child/...]`

#### 3.3.2 URI Examples

**File-based resource:**

```
file:///path/to/resources.yaml#Http.Server.Example
```

**Template-generated resource (single level):**

```
http://localhost/template/ApiServer#Http.Server.api-us-east
```

**Nested template-generated resource (multiple levels):**

```
http://localhost/template/ApiServer#Http.Server/Http.Route/api-us-east
```

#### 3.3.3 URI Generation

The Runtime automatically generates URIs during loading:

1. **File Resources:** When a resource is loaded from a YAML file, its URI is set to `file://<absolute-path>#kind.name`
2. **Template-Generated Resources:** When a `TemplateDefinition` is instantiated, child resources receive URIs in the form `http://localhost/template/<DefinitionName>#kind.name`
3. **Nested Templates:** When a template generates other templates, the fragment path grows: `http://localhost/template/<Parent>#kind.name/kind.child/kind.grandchild`

#### 3.3.4 Metadata Fields

Each `RuntimeResource.metadata` includes:

```typescript
interface ResourceMetadata {
  name: string; // User-provided in YAML
  uri: string; // Runtime-computed during Step 4: Absolute URI identifying resource origin and lineage
  generationDepth: number; // Runtime-computed during Step 4: Nesting depth (0=file, 1+=template-generated)
  [key: string]: any; // User-provided custom labels or annotations
}
```

#### 3.3.5 Use Cases

- **Debugging:** Trace where a resource originated (file vs generated)
- **Introspection:** Query resources by source (e.g., all resources from a specific file)
- **Filtering:** Find all nested resources from a template
- **Auditing:** Track full lineage of dynamically generated resources
- **Caching:** Use URI as a stable identifier for resource metadata

#### 3.3.6 Registry Query Methods

Modules can query resources by URI through the `ModuleCreateContext`:

```typescript
// Get resource by exact URI
getResourceByUri(uri: string): RuntimeResource | undefined;

// Get all resources from a specific source file
getResourcesBySourcePath(path: string): RuntimeResource[];

// Get all resources with a specific generation depth
getResourcesByGenerationDepth(depth: number): RuntimeResource[];
```

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

### 4.2 Boot Sequence

The runtime follows a six-step boot sequence with strict ordering to ensure proper initialization dependencies. **Any error at any step immediately halts the entire boot sequence.**

#### Step 1: Load Manifests from YAML Files

**loadFromConfig() (via Loader):**

1. Read YAML files from runtime config `resources` list
2. Parse all YAML documents using `yaml.loadAll()`
3. Deserialize each document into a raw manifest object
4. Validate each manifest has `kind` and `metadata.name` fields (runtime fields `uri` and `generationDepth` are added later)
5. **If ANY parsing/validation error occurs: FAIL bootstrap immediately**

Result: Uncompiled manifest objects in memory.

#### Step 2: Compile Manifests with YAML-CEL Templating Engine

**compileManifests() (via yaml-cel-templating):**

For each raw manifest object, apply YAML-CEL templating compilation:

1. Process directives in priority order:
   - `$schema` - Type validation for parent scope data
   - `$let` - Variable definitions (scoped to current object and descendants)
   - `$assert` - Assertions with optional `$msg` error messages
   - `$if` / `$then` / `$else` - Conditional blocks
   - `$for` / `$do` - Iteration over collections
   - `$include` / `$with` - External file inclusion and composition

2. Resolve CEL interpolations (`${...}`) in string values

3. **If ANY compilation error occurs (CEL evaluation failure, assertion failure, schema validation failure): FAIL bootstrap immediately with detailed error context**

Result: Fully expanded manifest objects ready for registration. All structural directives processed, all interpolations resolved.

See [yaml-cel-templating/README.md](../yaml-cel-templating/README.md) for comprehensive directive documentation.

#### Step 3: Register Compiled Manifests into Registry

**registerResources():**

1. For each compiled manifest:
   - Extract `kind` and `metadata.name`
   - Add manifest to registry: `registry[kind][name] = manifest`
     - Registry checks if `(kind, name)` pair already exists in registry
     - **If duplicate found: FAIL bootstrap immediately with error**
   - Emit `Resource.Registered` event

2. Index resources for discovery (by URI, source file, generation depth)

Result: Registry populated with all compiled manifests, indexed by Kind and Name.

#### Step 4: Multi-Pass Controller Discovery Loop (Max 10 Passes)

**discoverAndCreateResources() - Loop:**

Run up to 10 passes to discover resource definitions and create resource instances. Each pass removes handled resources from the list, making subsequent passes faster:

```
unhandledResources = getAll resources from registry as list
passNumber = 1

while (passNumber <= 10 && unhandledResources is not empty):
  handledThisPass = []

  for each resource in unhandledResources:
    definition = find definition for resource.kind

    if definition not found:
      continue  # Try again in next pass

    # Assign URI just before passing to create()
    resource.metadata.uri = generateUri(resource.kind, resource.name)

    # Create resource instance
    controller = find controller for definition
    if controller
      instance = controller.create(resource, context)
    else
      instance = wrapped resource

    if instance != null:
      resourceInstances[resource.kind][resource.name] = instance

      # Initialize immediately after creation
      if instance.init exists:
        await instance.init()

      emit `{resource.kind}.Initialized` event
      handledThisPass.append(resource)

  # Remove handled resources from list (list gets smaller each pass)
  unhandledResources = unhandledResources.filter(r => r not in handledThisPass)

  if handledThisPass is empty:
    break  # No resources handled this pass

  passNumber++

# After all passes complete
if unhandledResources is not empty:
  # FAIL: Unhandled resources remain
  for each resource in unhandledResources:
    FAIL bootstrap with error:
      "No controller found for resource: {resource.kind}.{resource.name}"
```

**Key Points:**

- Start with full list of unhandled resources
- Each pass removes successfully handled resources
- List gets progressively smaller (faster iterations)
- Maximum 10 passes prevents infinite loops from circular dependencies
- URI assignment and resource initialization (`instance.init()`) happens just after `controller.create()` call
- If any resources remain unhandled after all passes: FAIL bootstrap immediately
- If any controller.create() or instance.init() throws error: FAIL bootstrap immediately

#### Event Order Example

For a runtime with Http.Server and JavaScript.Script (created in Pass 1):

```
Resource.Registered (Http.Server:Api)
Resource.Registered (JavaScript.Script:MyHandler)
Runtime.Starting
Http.Server:Api.Initialized
JavaScript.Script.MyHandler.Initialized
Runtime.Started
```

For a runtime with nested resource dependencies (created across multiple passes):

```
Resource.Registered (Data.Type.User)
Resource.Registered (Http.Server.api)
Resource.Registered (Http.Route.GetUser)
Runtime.Starting

# Pass 1
Data.Type.User instance created
Data.Type.User.Initialized
Http.Server.api instance created
Http.Server.api.Initialized

# Pass 2
Http.Route.GetUser instance created
Http.Route.GetUser.Initialized

Runtime.Started
```

#### Error Scenarios (All Halt Bootstrap)

1. **Compilation Error:** CEL expression fails to evaluate, assertion fails, schema validation fails
2. **Duplicate Resource:** Two resources with same (kind, name) pair
3. **Unhandled Resource:** After 10 passes, resource kind has no controller
4. **Creation Failure:** controller.create() throws error
5. **Initialization Failure:** instance.init() throws error
6. **Parse Error:** YAML parsing fails, manifest missing required fields

#### Key Invariants

- All modules registered before boot sequence starts
- Compilation must succeed for all manifests before any registration
- Registration must succeed for all manifests before controller discovery
- Controller discovery runs in passes until no new resources are created
- Each resource is created and initialized exactly once
- No resource proceeds without a valid controller
- Bootstrap halts immediately on first error with context

## 5. Module Entry Point

Modules export a single `register` function and may export a `create` function for per-resource instances.

```typescript
export function register(ctx: ControllerContext): void | Promise<void>;
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
  /**
   * Optional method for debugging/snapshots
   * Called when taking runtime state snapshots
   * Should return serializable state data specific to this resource
   */
  snapshot?(): Record<string, any> | Promise<Record<string, any>>;
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
kind: Runtime.Definition
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

Each module can define the kinds of resources it handles using Runtime.Definition files:

```typescript
interface ResourceDefinition {
  kind: 'Runtime.Definition';
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
export function register(ctx: ControllerContext): void | Promise<void>;
export function create(
  resource: RuntimeResource,
  ctx: ModuleCreateContext,
): ResourceInstance | null | Promise<ResourceInstance | null>;
export function execute(name: string, input: any, ctx: any): Promise<any>;
```

When a controller is defined for a Kind, it is used instead of the module-level entrypoint for that Kind.

### 10.4 Module Discovery and Import

The Runtime supports module imports, allowing modules to depend on other modules.
When a module imports another module, both are registered separately in the kernel, maintaining isolation between their resource kinds and execution contexts.

## 11. Debugging and Observability

The Digly Runtime provides built-in debugging capabilities useful for testing and runtime introspection.

### 11.1 Event Streaming

Event streaming captures all runtime events to a JSONL file for debugging and testing purposes.

**Enable via CLI:**

```bash
digly --debug ./runtime.yaml
```

**Output:** Creates `.digly-debug/events.jsonl` with newline-delimited JSON events. Each line contains:

```typescript
{
  timestamp: string;      // ISO-8601 timestamp
  event: string;          // Event name (e.g., 'Runtime.Started', 'Module.Registered')
  payload?: any;          // Event-specific data
  module?: string;        // Optional: module name
  resource?: string;      // Optional: resource URN
  kind?: string;          // Optional: resource kind
  name?: string;          // Optional: resource name
}
```

**Use Cases:**

- **Testing:** Verify that specific events occur in the correct order
- **Debugging:** Observe runtime execution flow without console logging
- **Profiling:** Record timestamps to measure execution duration between events

**API Usage:**

```typescript
const kernel = new Kernel();
await kernel.enableEventStream('./debug.jsonl');

// Later, read events for testing
const events = await kernel.getEventStream().readAll();
const startedEvents = await kernel
  .getEventStream()
  .getEventsByType('Runtime.Started');
```

### 11.2 State Snapshots

State snapshots capture the current runtime state (registry, resource instances, and custom state) into a YAML file for inspection and debugging.

**Enable via CLI:**

```bash
digly --snapshot-on-exit ./runtime.yaml
```

**Output:** Creates `.digly-debug/snapshot.yaml` containing:

```yaml
timestamp: '2026-02-02T10:30:45.123Z'
resources:
  - kind: Http.Server
    name: myserver
    metadata:
      uri: 'file:///path/to/resources.yaml#Http.Server.myserver'
      generationDepth: 0
    data:
      port: 8080
      host: localhost
    snapshot: # Optional: custom snapshot data from resource instance
      activeConnections: 42
      uptime: 3600000
```

**Resource Organization:**

Snapshots organize resources by `generationDepth` (a depth-first traversal):

- **Depth 0:** Directly loaded resources from YAML files
- **Depth 1+:** Resources generated from templates or nested generation

This enables understanding resource hierarchy and template-generated resource relationships.

**Custom Resource Snapshots:**

Resource implementations can define a `snapshot()` method to include custom state:

```typescript
export interface ResourceInstance {
  init?(): void | Promise<void>;
  teardown?(): void | Promise<void>;

  /**
   * Optional method for snapshots
   * Called when taking runtime state snapshots
   * Should return serializable state specific to this resource
   */
  snapshot?(): Record<string, any> | Promise<Record<string, any>>;
}
```

**Example implementation:**

```typescript
const server: ResourceInstance = {
  async init() {
    // startup logic
  },

  async snapshot() {
    return {
      activeConnections: this.connections.size,
      uptime: Date.now() - this.startTime,
      requests: this.requestCount,
    };
  },
};
```

**API Usage:**

```typescript
const kernel = new Kernel();
await kernel.loadFromConfig('./runtime.yaml');
await kernel.start();

// Take snapshot at any point
const snapshot = await kernel.takeSnapshot('./runtime-snapshot.yaml');

// Or just get the data without writing to file
const snapshotData = await kernel.takeSnapshot();
console.log(snapshotData.resources);
```

### 11.3 Combining Debug Flags

Multiple debug flags can be combined:

```bash
digly --verbose --debug --snapshot-on-exit ./runtime.yaml
```

This enables verbose console logging, event streaming, and creates a final state snapshot on exit.

## 12. The Runtime Manifest (runtime.yaml)

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
