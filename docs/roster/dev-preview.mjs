// Local-only launcher. Does not create env files or contact Supabase itself.
// Browser activity will use tm-ops-dev. Never run without explicit dev configuration.
import { fileURLToPath } from 'node:url'
import { resolve, relative } from 'node:path'
import { existsSync } from 'node:fs'
import { createServer, loadEnv } from '../../app/node_modules/vite/dist/node/index.js'
import appConfig from '../../app/vite.config.js'

const appRoot = fileURLToPath(new URL('../../app/', import.meta.url))
const envDirInput = process.env.TM_OPS_DEV_ENV_DIR
if (!envDirInput) throw new Error('Set TM_OPS_DEV_ENV_DIR to an external development-only environment directory.')
const envDir = resolve(envDirInput)
const repository = resolve(appRoot, '..')
if (!relative(repository, envDir).startsWith('..')) throw new Error('Development environment directory must be outside the repository.')
if (!existsSync(resolve(envDir, '.env'))) throw new Error('External development .env file is required; production fallback is forbidden.')
if (Object.keys(process.env).some(k => k.startsWith('VITE_'))) throw new Error('Use a clean terminal environment without inherited VITE_* values.')
const env = loadEnv('tmopsdev', envDir, 'VITE_')
const allowed = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_PUBLISHABLE_KEY']
if (Object.keys(env).some(k => !allowed.includes(k))) throw new Error('Development browser configuration permits only the two required public VITE_* settings.')
if (env.VITE_SUPABASE_URL !== 'https://bmfvcnsuduttebxbjvwx.supabase.co') throw new Error('Wrong or missing Supabase development URL; refusing to start.')
if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(env.VITE_SUPABASE_PUBLISHABLE_KEY || '')) throw new Error('A current development publishable key is required. Value hidden.')
if (process.argv.includes('--check')) {
  console.log('Development configuration validated for bmfvcnsuduttebxbjvwx; no server started and key hidden.')
} else {
  const server = await createServer({ ...appConfig, configFile: false, root: appRoot, envDir, mode: 'tmopsdev',
    cacheDir: '/private/tmp/tm-ops-dev-vite-cache',
    server: { host: '127.0.0.1', port: 5175, strictPort: true } })
  await server.listen()
  console.log('tm-ops-dev only: http://127.0.0.1:5175/tm-opsperformance/#/login')
}
