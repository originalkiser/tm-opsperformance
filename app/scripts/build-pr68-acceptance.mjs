// Completed temporary acceptance preview. No application or backend is published.
import {mkdirSync,rmSync,writeFileSync} from 'node:fs'
import {execFileSync} from 'node:child_process'
const branch=process.env.CF_PAGES_BRANCH || execFileSync('git',['branch','--show-current'],{encoding:'utf8'}).trim()
if(branch!=='codex/pr68-device-acceptance') throw Error('Session-closure build is restricted to its temporary branch')
rmSync('dist',{recursive:true,force:true});mkdirSync('dist',{recursive:true})
writeFileSync('dist/index.html','<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>PR68 Acceptance Session Closed</title><main><h1>Acceptance session closed</h1><p>Device testing is complete. Temporary access has been revoked.</p></main></html>')
writeFileSync('dist/_headers',"/*\n  Content-Security-Policy: default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'\n  Permissions-Policy: camera=(), microphone=(), geolocation=()\n  Cache-Control: no-store\n  Referrer-Policy: no-referrer\n  X-Robots-Tag: noindex, nofollow\n")
writeFileSync('dist/robots.txt','User-agent: *\nDisallow: /\n')
console.log('Acceptance session closed: static page only; no backend, scripts or camera access')
