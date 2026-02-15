# Voke Modules

This directory contains Voke modules packaged for use by the runtime. Each module is self‑contained and declared by its own manifest, resources, and definitions.

## How Modules Fit Together

Modules own specific **resource kinds**. A runtime manifest composes multiple modules into one host, and execution is routed by Kind to the owning module. This keeps the system modular and lets teams add or replace capabilities without changing the core runtime.

## Included Modules

- **http-server/**: provides Http.Server resources to define and run HTTP APIs.
