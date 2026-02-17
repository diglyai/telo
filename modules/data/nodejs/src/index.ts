import { ResourceInstance } from "@telorun/sdk";

class DataTypeResource implements ResourceInstance {}

export function create() {
  return new DataTypeResource();
}
