import { build } from 'vite'
import config from '../vite.config.js'
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
const branch = process.env.CF_PAGES_BRANCH || execFileSync('git',['branch','--show-current'],{encoding:'utf8'}).trim()
if(branch !== 'codex/pr68-device-acceptance') throw Error('Acceptance build is forbidden on any other branch')
const devUrl = 'https://bmfvcnsuduttebxbjvwx.supabase.co'
const devKey = "sb_publishable_ZJj5WbMxgcUCdiBFL5-__w_g30iIA5_"
if(!devKey.startsWith('sb_publishable_'))throw Error('Only the existing development publishable key is allowed')
await build({...config,configFile:false,envDir:false,base:'/',define:{...config.define,
 'import.meta.env.VITE_SUPABASE_URL':JSON.stringify(devUrl),
 'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY':JSON.stringify(devKey),
 'import.meta.env.VITE_SUPABASE_ANON_KEY':JSON.stringify('')
}})
const files=[];function walk(dir){for(const name of readdirSync(dir)){const p=join(dir,name);if(statSync(p).isDirectory())walk(p);else files.push(p)}}walk('dist')
for(const file of files){if(!/\.(js|html|css|json)$/.test(file))continue;const s=readFileSync(file,'utf8');if(s.includes('qbdvixxooofdlfurcpqy')||/sb_secret_[A-Za-z0-9]/.test(s))throw Error('Forbidden production reference or secret in output: '+file)}
let html=readFileSync('dist/index.html','utf8').replace('<title>TM Ops Performance</title>','<title>PR68 Acceptance — DEV ONLY</title>').replace('<body>','<body><div style="padding:10px;background:#fff0b3;color:#10233f;text-align:center;font-weight:bold">PR68 DEVICE ACCEPTANCE — FICTIONAL DEV DATA ONLY</div>')
writeFileSync('dist/index.html',html)
writeFileSync('dist/_headers',`/*
  Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: https://bmfvcnsuduttebxbjvwx.supabase.co; connect-src 'self' https://bmfvcnsuduttebxbjvwx.supabase.co wss://bmfvcnsuduttebxbjvwx.supabase.co; worker-src 'self' blob:; object-src 'none'; frame-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'
  Permissions-Policy: camera=(self), microphone=(), geolocation=()
  Referrer-Policy: no-referrer
  X-Content-Type-Options: nosniff
  X-Robots-Tag: noindex, nofollow
  Cache-Control: no-store
`)
writeFileSync('dist/robots.txt','User-agent: *\\nDisallow: /\\n')
writeFileSync('dist/acceptance-build.json',JSON.stringify({source:'0f9c7748dff539e9ee6821bcd6e886b344a2ac07',backend:'tm-ops-dev',productionAccess:false,branch}))
console.log('Isolated acceptance build verified: dev-only URL/key; production project reference absent')

