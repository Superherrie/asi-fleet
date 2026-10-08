// Lets node run the app's TypeScript sources directly (node --experimental-strip-types --import ./scripts/ts-loader.mjs x.ts):
// resolves the extension-less relative imports used in src/lib to the .ts file on disk.
import { register } from 'node:module'; import { pathToFileURL } from 'node:url'
register(pathToFileURL('./scripts/ts-loader-hooks.mjs'))
