export interface RuntimeResource {
  kind: string;
  metadata: {
    name: string;
    module: string;
    [key: string]: any;
  };
}
