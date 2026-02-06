export interface RuntimeResource {
  kind: string;
  metadata: {
    name: string;
    module: string;
    uri: string;
    [key: string]: any;
  };
}
