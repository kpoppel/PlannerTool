import resolve from '@rollup/plugin-node-resolve';
import terser from '@rollup/plugin-terser';

const basePlugins = [resolve(), terser()];

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
