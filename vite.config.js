import { defineConfig } from 'vite'
import { resolve, dirname } from 'path'
import fs from 'fs'

// Plugin: help resolve relative imports that reference the repo's `www/js` files
function resolveWwwJsPlugin(rootDir) {
	return {
		name: 'resolve-www-js-relative',
		resolveId(source, importer) {
				if (!importer || !source) return null
				// normalize file:// importers (Vitest provides file URLs)
				let importerPath = importer;
				try {
					if (importerPath.startsWith('file://')) importerPath = new URL(importerPath).pathname;
					// Vitest/Vite may provide importer ids like '/@fs/...' — strip the /@fs prefix
					if (importerPath.startsWith('/@fs/')) importerPath = importerPath.replace(/^\/@fs/, '');
				} catch (e) { /* fallthrough, use original importer */ }
			// quickly check for mentions of www/js in the import path
			if (!source.includes('www/js')) return null
			try {
				// try resolving relative to the importer
				const baseCandidate = resolve(dirname(importerPath), source)
				const trySuffixes = ['', '.js', '.mjs', '.ts', '/index.js', '/index.mjs']
				for (const sfx of trySuffixes) {
					const cand = baseCandidate + sfx
					if (fs.existsSync(cand)) return cand
				}
				// try resolving from project root (strip any leading ./)
				const rootCandidateBase = resolve(rootDir, source.replace(/^\.\/?/, ''))
				for (const sfx of trySuffixes) {
					const cand = rootCandidateBase + sfx
					if (fs.existsSync(cand)) return cand
				}
			} catch (e) {
				// fallthrough
			}
			return null
		}
	}
}

export default defineConfig({
	resolve: {
		alias: {
			// tests import '@esm-bundle/chai' — alias to installed 'chai'
			'@esm-bundle/chai': 'chai',
			// Provide aliases so absolute-style imports to the app's www/* resolve in tests
			'www': resolve(__dirname, 'www'),
			'www/js': resolve(__dirname, 'www/js')
		}
	},
	plugins: [resolveWwwJsPlugin(resolve(__dirname))]
})
