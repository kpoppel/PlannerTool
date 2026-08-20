import resolve from '@rollup/plugin-node-resolve';
import terser from '@rollup/plugin-terser';

function injectTsNoCheck() {
  return {
    name: 'inject-ts-nocheck',
    generateBundle(_outputOptions, bundle) {
      for (const asset of Object.values(bundle)) {
        if (asset.type !== 'chunk') continue;
        if (asset.code.startsWith('// @ts-nocheck')) continue;
        asset.code = `// @ts-nocheck\n${asset.code}`;
      }
    },
  };
}

const basePlugins = [resolve(), terser(), injectTsNoCheck()];

export default [
  {
    input: 'src/vendor-entry.js',
    plugins: basePlugins,
    output: {
      file: 'www/js/vendor/lit.js',
      format: 'es',
      sourcemap: true,
    },
  },
  {
    input: 'src/vendor-entry-zustand.js',
    plugins: basePlugins,
    output: {
      file: 'www/js/vendor/zustand.js',
      format: 'es',
      sourcemap: true,
    },
  },
];
