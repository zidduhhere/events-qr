import test from 'node:test'
import assert from 'node:assert/strict'
import {resolveConfig} from 'vite'
test('frontend API proxy follows the configured backend port in dev and preview',async()=>{
 const previous=process.env.PORT;process.env.PORT='1212'
 try{const config=await resolveConfig({configFile:'vite.config.ts'},'serve');assert.equal(config.server.proxy?.['/api'],'http://127.0.0.1:1212');assert.equal(config.preview.proxy?.['/api'],'http://127.0.0.1:1212')}
 finally{if(previous===undefined)delete process.env.PORT;else process.env.PORT=previous}
})
