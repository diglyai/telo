import { RuntimeResource } from '@diglyai/sdk';

class DataTypeResource implements RuntimeResource {}

export function create(): RuntimeResource {
  return new DataTypeResource();
}
