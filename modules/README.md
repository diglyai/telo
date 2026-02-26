# Telo Modules

This directory contains Telo modules packaged for use by the kernel. Each module is self‑contained and declared by its own manifest, resources, and definitions.

## How Modules Fit Together

Modules own specific **resource kinds**. A kernel manifest composes multiple modules into one host, and execution is routed by Kind to the owning module. This keeps the system modular and lets teams add or replace capabilities without changing the core kernel.

## Included Modules

- **http-server/**: provides Http.Server resources to define and run HTTP APIs.
