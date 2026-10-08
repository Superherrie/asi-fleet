import { existsSync } from 'node:fs'; import { fileURLToPath } from 'node:url'
export async function resolve(spec, ctx, next) {
  if (spec.startsWith('.') && !/\.[a-z]+$/.test(spec) && ctx.parentURL) { const base = new URL(spec, ctx.parentURL); for (const ext of ['.ts', '.tsx', '/index.ts']) { if (existsSync(fileURLToPath(base.href + ext))) return next(base.href + ext, ctx) } }
  return next(spec, ctx)
}
