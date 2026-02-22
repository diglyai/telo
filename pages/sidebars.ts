import type { SidebarsConfig } from '@docusaurus/plugin-content-docs'

const sidebars: SidebarsConfig = {
  docs: [
    { type: 'doc', id: 'README', label: 'Introduction' },
    {
      type: 'category',
      label: 'Runtime',
      items: [{ type: 'doc', id: 'runtime/README', label: 'Specification' }],
    },
    {
      type: 'category',
      label: 'Templating',
      items: [{ type: 'doc', id: 'yaml-cel-templating/README', label: 'CEL-YAML Specification' }],
    },
    {
      type: 'category',
      label: 'Modules',
      items: [
        { type: 'doc', id: 'modules/README', label: 'Overview' },
        { type: 'doc', id: 'modules/studio/README', label: 'Studio' },
      ],
    },
    {
      type: 'category',
      label: 'SDK',
      items: [
        { type: 'doc', id: 'sdk/README', label: 'Overview' },
        { type: 'doc', id: 'sdk/nodejs/README', label: 'Node.js' },
      ],
    },
  ],
}

export default sidebars
