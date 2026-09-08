import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {handleSuperBotRoute} from '../dist/superbot.js';
const server=createServer(async(req,res)=>{let u=new URL(req.url,'http://localhost');await handleSuperBotRoute(req,res,u.pathname,u);});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
after(()=>server.close());
const base=`http://127.0.0.1:${server.address().port}/superbot`;
async function req(path,body){const r=await fetch(base+path,body?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{});assert.equal(r.status,200);return r.json();}
async function call(name,args){let r=await req('/mcp',{jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}});return JSON.parse(r.result.content[0].text);}
async function submit(deviceId,mediaUri){return (await call('superbot_submit_publication',{deviceId,mediaUri,platform:'TikTok',scheduledAt:Date.now()+86400000})).commandId;}
const status=id=>call('superbot_get_task_status',{commandId:id});
const poll=id=>req('/device/commands?deviceId='+id);
test('dispatch is not completion; second video waits for confirmed menu handoff',async()=>{
 const d='sequential',one=await submit(d,'one.mp4'),two=await submit(d,'two.mp4');
 assert.deepEqual((await poll(d)).commands.map(c=>c.id),[one]);
 await req(`/device/commands/${one}/result`,{ok:true,message:'publication_dispatched:local:TikTok'});
 assert.equal((await status(one)).status,'running');assert.equal((await poll(d)).commands.length,0);
 await req(`/device/commands/${one}/progress`,{status:'running',stage:'TIKTOK_CONFIRMING'});
 await req(`/device/commands/${one}/result`,{ok:true,status:'completed',taskId:one,confirmation:'tiktok_schedule_confirmed',menuReturned:false});
 assert.equal((await status(one)).status,'running');assert.equal((await poll(d)).commands.length,0);
 await req(`/device/commands/${one}/result`,{ok:true,status:'completed',taskId:one,confirmation:'tiktok_schedule_confirmed',menuReturned:true});
 assert.equal((await status(one)).status,'completed');assert.deepEqual((await poll(d)).commands.map(c=>c.id),[two]);
 await req(`/device/commands/${one}/progress`,{status:'running'});assert.equal((await status(one)).status,'completed');
});
test('paused and failed missions block following video while control commands remain available',async()=>{
 const d='paused',one=await submit(d,'one.mp4');await submit(d,'two.mp4');await poll(d);
 await req(`/device/commands/${one}/progress`,{status:'paused',stage:'TIKTOK_PAUSED'});
 const control=await call('superbot_back',{deviceId:d});assert.deepEqual((await poll(d)).commands.map(c=>c.id),[control.commandId]);
 await req(`/device/commands/${one}/result`,{ok:false,message:'no_confirmation'});assert.equal((await poll(d)).commands.length,0);
});
test('a task from Android locks dispatch; different device remains independent',async()=>{
 await req('/device/state',{deviceId:'busy',activeTask:{id:'local'}});await submit('busy','x.mp4');
 assert.equal((await poll('busy')).commands.length,0);
 const id=await submit('other','y.mp4');assert.deepEqual((await poll('other')).commands.map(c=>c.id),[id]);
});
test('wrong task identity and generic success do not complete publication',async()=>{
 const d='wrong',id=await submit(d,'x.mp4');await poll(d);
 await req(`/device/commands/${id}/result`,{ok:true,status:'completed',taskId:'wrong',confirmation:'tiktok_schedule_confirmed',menuReturned:true});
 assert.equal((await status(id)).status,'running');
});
