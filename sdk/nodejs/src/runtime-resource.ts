export interface RuntimeResource {
  kind: string;
  metadata: {
    name: string;
    module: string;
    parent?: string;
    [key: string]: any;
  };
}
