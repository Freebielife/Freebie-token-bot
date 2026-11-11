import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {deflateSync} from "node:zlib";
import worker,{WIDGET_HTML} from "../src/worker.js";
const env={BOT_TOKEN:"fake-token",SETUP_KEY:"test-only-secret",PUBLIC_BASE_URL:"https://example.workers.dev"};
const secret=createHash("sha256").update("freebie-webhook:"+env.SETUP_KEY).digest("hex");
let calls=[];
globalThis.fetch=async(url,options)=>{
 const method=url.split("/").pop(),body=JSON.parse(options.body);calls.push({method,body});
 return Response.json({ok:true,result:method==="getWebhookInfo"?{url:env.PUBLIC_BASE_URL+"/webhook"}:{}});
};
const req=(path,options={})=>new Request("https://preview.invalid"+path,options);
const hook=(update,token=secret)=>worker.fetch(req("/webhook",{method:"POST",headers:{"X-Telegram-Bot-Api-Secret-Token":token},body:JSON.stringify(update)}),env);
test("health and setup do not expose secrets",async()=>{
 for(const path of ["/health","/setup"]){const r=await worker.fetch(req(path),env);assert.equal(r.status,200);assert.ok(!(await r.text()).includes(env.BOT_TOKEN));}
});
test("missing configuration and wrong key give distinct errors",async()=>{
 assert.equal((await worker.fetch(req("/setup"),{})).status,503);
 calls=[];const r=await worker.fetch(req("/setup",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:"key=wrong"}),env);
 assert.equal(r.status,403);assert.equal(calls.length,0);
});
test("setup works without Origin and uses configured canonical URL",async()=>{
 calls=[];const r=await worker.fetch(req("/setup",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({key:env.SETUP_KEY}).toString()}),env);
 assert.equal(r.status,200);assert.equal(calls[0].method,"setWebhook");
 assert.equal(calls[0].body.url,env.PUBLIC_BASE_URL+"/webhook");
 assert.equal(calls[0].body.secret_token,secret);assert.equal(calls[1].method,"getWebhookInfo");
});
test("webhook rejects unauthenticated calls",async()=>{
 calls=[];assert.equal((await hook({update_id:1},"wrong")).status,403);assert.equal(calls.length,0);
});
test("start provides KITO and duplicate update is suppressed",async()=>{
 calls=[];const u={update_id:2,message:{chat:{id:123,type:"private"},text:"/start"}};
 assert.equal((await hook(u)).status,200);await hook(u);
 assert.equal(calls.length,1);assert.equal(calls[0].body.reply_markup.inline_keyboard[0][0].callback_data,"kito");
});
test("KITO sends widget and refresh updates message data",async()=>{
 calls=[];const q={id:"demo",message:{chat:{id:123,type:"private"},message_id:7}};
 await hook({update_id:3,callback_query:{...q,data:"kito"}});
 assert.equal(calls[1].method,"sendWidget");assert.equal(calls[1].body.html,WIDGET_HTML);
 calls=[];await hook({update_id:4,callback_query:{...q,data:"refresh"}});
 assert.equal(calls[1].method,"editMessageWidgetData");assert.equal(calls[1].body.message_id,7);
 assert.ok(JSON.parse(calls[1].body.chat_data).checked);
});
test("group start is ignored",async()=>{
 calls=[];await hook({update_id:5,message:{chat:{id:123,type:"group"},text:"/start"}});assert.equal(calls.length,0);
});
test("widget fits Telegram byte limits",()=>{
 assert.ok(Buffer.byteLength(WIDGET_HTML)<=32768);assert.ok(deflateSync(WIDGET_HTML,{level:9}).length<=4096);
});
