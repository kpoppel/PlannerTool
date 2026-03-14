import resolve from '@rollup/plugin-node-resolve';
import { terser } from 'rollup-plugin-terser';

export default {
  input: 'src/vendor-entry.js',
  plugins: [resolve()],
  output: {
    file: 'www/js/vendor/lit.bundle.js',
    format: 'es',
    sourcemap: false,
  }
};
