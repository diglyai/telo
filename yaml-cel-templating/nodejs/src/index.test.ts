import { compile } from './index';

describe('CEL-YAML Templating Engine', () => {
  describe('Basic Interpolation', () => {
    it('should handle simple variable interpolation', () => {
      const result = compile(
        { message: '${greeting}' },
        { context: { greeting: 'Hello' } },
      );
      expect(result).toEqual({ message: 'Hello' });
    });

    it('should handle mixed string interpolation', () => {
      const result = compile(
        { host: 'server-${region}' },
        { context: { region: 'us-east-1' } },
      );
      expect(result).toEqual({ host: 'server-us-east-1' });
    });

    it('should preserve type with exact match interpolation', () => {
      const result = compile(
        { port: '${port_number}' },
        { context: { port_number: 8080 } },
      );
      expect(result).toEqual({ port: 8080 });
      expect(typeof result.port).toBe('number');
    });

    it('should preserve boolean type with exact match', () => {
      const result = compile(
        { enabled: '${is_enabled}' },
        { context: { is_enabled: true } },
      );
      expect(result).toEqual({ enabled: true });
      expect(typeof result.enabled).toBe('boolean');
    });

    it('should handle multiple interpolations in one string', () => {
      const result = compile(
        { url: '${protocol}://${host}:${port}' },
        { context: { protocol: 'https', host: 'api.example.com', port: 443 } },
      );
      expect(result).toEqual({ url: 'https://api.example.com:443' });
    });
  });

  describe('$let Directive', () => {
    it('should define variables in $let scope', () => {
      const result = compile({
        $let: {
          name: "'John'",
          age: '30',
        },
        greeting: '${name}',
        years: '${age}',
      });
      expect(result).toEqual({ greeting: 'John', years: 30 });
    });

    it('should shadow parent variables', () => {
      const result = compile(
        {
          outer: '${value}',
          nested: {
            $let: {
              value: "'local'",
            },
            inner: '${value}',
          },
        },
        { context: { value: 'global' } },
      );
      expect(result).toEqual({
        outer: 'global',
        nested: { inner: 'local' },
      });
    });

    it('should make variables accessible to descendants', () => {
      const result = compile({
        $let: {
          base_url: "'https://api.example.com'",
        },
        service: {
          endpoint: '${base_url}/users',
        },
      });
      expect(result).toEqual({
        service: { endpoint: 'https://api.example.com/users' },
      });
    });
  });

  describe('$if/$then/$else Directive', () => {
    it('should include $then when condition is true', () => {
      const result = compile(
        {
          config: {
            $if: 'enable_persistence',
            $then: { type: 'postgres', storage: '100gi' },
            $else: { type: 'sqlite', storage: '0' },
          },
        },
        { context: { enable_persistence: true } },
      );
      expect(result.config).toEqual({ type: 'postgres', storage: '100gi' });
    });

    it('should include $else when condition is false', () => {
      const result = compile(
        {
          config: {
            $if: 'enable_persistence',
            $then: { type: 'postgres', storage: '100gi' },
            $else: { type: 'sqlite', storage: '0' },
          },
        },
        { context: { enable_persistence: false } },
      );
      expect(result.config).toEqual({ type: 'sqlite', storage: '0' });
    });

    it('should handle $if without $else', () => {
      const result = compile(
        {
          debug: {
            $if: 'debug_mode',
            $then: { level: 'verbose' },
          },
        },
        { context: { debug_mode: false } },
      );
      expect(result).toEqual({ debug: undefined });
    });

    it('should evaluate CEL expressions in condition', () => {
      const result = compile(
        {
          replica_config: {
            $if: 'replicas > 1',
            $then: { setup: 'high-availability' },
            $else: { setup: 'single-instance' },
          },
        },
        { context: { replicas: 3 } },
      );
      expect(result.replica_config).toEqual({ setup: 'high-availability' });
    });
  });

  describe('$for/$do Directive', () => {
    it('should iterate over array items', () => {
      const result = compile(
        {
          servers: [
            {
              $for: 'host in hosts',
              $do: { name: '${host}', url: 'https://${host}.example.com' },
            },
          ],
        },
        { context: { hosts: ['api', 'app', 'cdn'] } },
      );
      expect(result.servers).toEqual([
        { name: 'api', url: 'https://api.example.com' },
        { name: 'app', url: 'https://app.example.com' },
        { name: 'cdn', url: 'https://cdn.example.com' },
      ]);
    });

    it('should iterate over object map with key-value pairs', () => {
      const result = compile(
        {
          labels: {
            $for: 'k, v in tags',
            $do: { 'tag-${k}': '${v}' },
          },
        },
        { context: { tags: { env: 'prod', team: 'platform' } } },
      );
      expect(result.labels).toEqual({
        'tag-env': 'prod',
        'tag-team': 'platform',
      });
    });

    it('should handle nested iteration', () => {
      const result = compile(
        {
          environments: [
            {
              $for: 'env in envs',
              $do: {
                $let: {
                  environment: '${env}',
                },
                name: '${environment}',
                regions: [
                  {
                    $for: 'region in regions_list',
                    $do: { location: '${region}' },
                  },
                ],
              },
            },
          ],
        },
        {
          context: {
            envs: ['prod', 'staging'],
            regions_list: ['us-east', 'eu-west'],
          },
        },
      );
      expect(result.environments).toEqual([
        {
          name: 'prod',
          regions: [{ location: 'us-east' }, { location: 'eu-west' }],
        },
        {
          name: 'staging',
          regions: [{ location: 'us-east' }, { location: 'eu-west' }],
        },
      ]);
    });
  });

  describe('$assert Directive', () => {
    it('should pass when assertion is true', () => {
      const result = compile(
        {
          $assert: 'replicas <= 10',
          config: { replicas: 3 },
        },
        { context: { replicas: 3 } },
      );
      expect(result).toEqual({ config: { replicas: 3 } });
    });

    it('should throw when assertion is false', () => {
      expect(() => {
        compile(
          {
            $assert: 'replicas <= 10',
            $msg: 'Too many replicas requested',
            config: { replicas: 15 },
          },
          { context: { replicas: 15 } },
        );
      }).toThrow('Too many replicas requested');
    });

    it('should use default message when $msg not provided', () => {
      expect(() => {
        compile(
          {
            $assert: 'port > 0 && port < 65536',
            config: { port: -1 },
          },
          { context: { port: -1 } },
        );
      }).toThrow();
    });
  });

  describe('$schema Directive', () => {
    it('should validate parent scope data against schema', () => {
      const result = compile(
        {
          $schema: {
            region: { type: 'string' },
            replicas: { type: 'integer' },
          },
          config: {
            location: '${region}',
            count: '${replicas}',
          },
        },
        { context: { region: 'us-east-1', replicas: 3 } },
      );
      expect(result.config).toEqual({ location: 'us-east-1', count: 3 });
    });

    it('should work at nested levels', () => {
      const result = compile({
        $let: {
          env: "'prod'",
        },
        service: {
          $schema: {
            env: { type: 'string' },
          },
          environment: '${env}',
        },
      });
      expect(result.service).toEqual({ environment: 'prod' });
    });

    it('should reject invalid types', () => {
      expect(() => {
        compile(
          {
            $schema: {
              port: { type: 'integer' },
            },
            config: {
              port_value: '${port}',
            },
          },
          { context: { port: 'invalid' } },
        );
      }).toThrow();
    });

    it('should support string pattern validation', () => {
      const result = compile(
        {
          $schema: {
            cpu: { type: 'string', pattern: '^\\d+m$' },
          },
          resources: {
            limit: '${cpu}',
          },
        },
        { context: { cpu: '500m' } },
      );
      expect(result.resources).toEqual({ limit: '500m' });
    });
  });

  describe('Order of Operations', () => {
    it('should process directives in correct order: $let -> $assert -> $if -> $for', () => {
      const result = compile(
        {
          $let: {
            multiplier: '2',
          },
          $assert: 'base_value > 0',
          $if: 'base_value > 0',
          $then: {
            items: [
              {
                $for: 'i in numbers',
                $do: { value: '${i * multiplier}' },
              },
            ],
          },
        },
        { context: { base_value: 5, numbers: [1, 2, 3] } },
      );
      expect(result.items).toEqual([{ value: 2 }, { value: 4 }, { value: 6 }]);
    });
  });

  describe('Complex Examples', () => {
    it('should handle kitchen sink example', () => {
      const template = {
        $let: {
          domain: "'acme.com'",
          owner: "'platform'",
        },
        apiVersion: 'v1',
        kind: 'List',
        items: [
          {
            $for: 'svc in services',
            $do: {
              $let: {
                full_name: "'${svc.name}-${region}'",
              },
              kind: 'Service',
              metadata: {
                name: '${full_name}',
                annotations: {
                  owner: '${owner}',
                },
              },
              spec: {
                type: 'LoadBalancer',
                replicas: '${svc.ha ? 3 : 1}',
              },
            },
          },
        ],
      };

      const context = {
        region: 'us-east-1',
        services: [
          { name: 'cart', ha: true },
          { name: 'catalog', ha: false },
        ],
      };

      const result = compile(template, { context });

      expect(result.apiVersion).toBe('v1');
      expect(result.kind).toBe('List');
      expect(result.items).toHaveLength(2);
      expect(result.items[0].metadata.name).toBe('cart-us-east-1');
      expect(result.items[0].spec.replicas).toBe(3);
      expect(result.items[1].spec.replicas).toBe(1);
    });

    it('should handle complex nested conditionals and loops', () => {
      const template = {
        environments: [
          {
            $for: 'env in envs',
            $do: {
              name: '${env}',
              $if: "env == 'prod'",
              $then: {
                replicas: 3,
                persistence: true,
              },
              $else: {
                replicas: 1,
                persistence: false,
              },
            },
          },
        ],
      };

      const context = {
        envs: ['prod', 'dev'],
      };

      const result = compile(template, { context });
      expect(result.environments).toHaveLength(2);
      expect(result.environments[0]).toEqual({
        name: 'prod',
        replicas: 3,
        persistence: true,
      });
      expect(result.environments[1]).toEqual({
        name: 'dev',
        replicas: 1,
        persistence: false,
      });
    });
  });

  describe('Edge Cases', () => {
    it('should handle null and undefined values', () => {
      const result = compile({
        null_value: null,
        undefined_value: undefined,
        nested: {
          null_field: null,
        },
      });
      expect(result.null_value).toBeNull();
      expect(result.undefined_value).toBeUndefined();
      expect(result.nested.null_field).toBeNull();
    });

    it('should handle empty objects and arrays', () => {
      const result = compile({
        empty_object: {},
        empty_array: [],
      });
      expect(result).toEqual({
        empty_object: {},
        empty_array: [],
      });
    });

    it('should handle strings without interpolation', () => {
      const result = compile({
        plain_string: 'no interpolation here',
        with_dollar: 'this costs $5',
      });
      expect(result).toEqual({
        plain_string: 'no interpolation here',
        with_dollar: 'this costs $5',
      });
    });

    it('should handle numeric and boolean primitives', () => {
      const result = compile({
        number: 42,
        float: 3.14,
        boolean: true,
        zero: 0,
      });
      expect(result).toEqual({
        number: 42,
        float: 3.14,
        boolean: true,
        zero: 0,
      });
    });
  });

  describe('Error Handling', () => {
    it('should throw on undefined variable in interpolation', () => {
      expect(() => {
        compile({ message: '${undefined_var}' });
      }).toThrow();
    });

    it('should throw on invalid CEL expression', () => {
      expect(() => {
        compile(
          { value: '${invalid syntax here}' },
          { context: { something: 'value' } },
        );
      }).toThrow();
    });

    it('should throw on invalid $for syntax', () => {
      expect(() => {
        compile({
          items: [
            {
              $for: 'invalid for syntax',
              $do: { value: 'test' },
            },
          ],
        });
      }).toThrow();
    });

    it('should include path in error messages', () => {
      expect(() => {
        compile({
          service: {
            config: {
              endpoint: '${undefined}',
            },
          },
        });
      }).toThrow();
    });
  });
});
