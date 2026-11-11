export const WIDGET_HTML = `
<style>
body{margin:14px;font-family:system-ui;color:var(--tg-theme-text-color)}
h2{margin:0}small{color:var(--tg-theme-hint-color)}
.price{font-size:24px;margin:12px 0}.stats{display:flex;flex-wrap:wrap;gap:16px}
svg{width:100%;height:100px}#status{overflow-wrap:anywhere}
</style>
<h2>KITO · 24 часа</h2><small>ДЕМО · не рыночные данные</small>
<div class="price">1 000 KITO / GRAM</div>
<div class="stats"><div>Покупки<br><b>120 GRAM</b></div><div>Продажи<br><b>80 GRAM</b></div></div>
<svg viewBox="0 0 300 100"><polyline points="0,80 25,70 50,76 75,45 100,55 125,35 150,43 175,24 200,38 225,19 250,25 275,12 300,20" fill="none" stroke="#22b879" stroke-width="3"/></svg>
<small>Пример графика · последние 24 часа</small>
<p id="status">Проверка обновления: ещё не выполнена</p>
<script>
function render(){
 var d={};try{d=JSON.parse(TelegramWidget.chatData||"{}")}catch(e){}
 document.getElementById("status").textContent=d.checked?"Обновление получено: "+d.checked:"Проверка обновления: ещё не выполнена";
}
TelegramWidget.onEvent("chatDataChanged",render);render();
</script>`;
const menu={inline_keyboard:[[{text:"KITO · тестовая карточка",callback_data:"kito"}]]};
const cardButtons={inline_keyboard:[[{text:"Проверить обновление",callback_data:"refresh"}],[{text:"К списку токенов",callback_data:"menu"}]]};
const headers={"Cache-Control":"no-store","Referrer-Policy":"no-referrer","X-Content-Type-Options":"nosniff"};
function text(value,status=200){return new Response(value,{status,headers:{...headers,"Content-Type":"text/plain; charset=utf-8"}})}
function page(){return new Response(`<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Freebie · подключение</title><style>body{font:18px system-ui;max-width:480px;margin:40px auto;padding:16px}input,button{box-sizing:border-box;width:100%;padding:12px;margin-top:12px}p{line-height:1.5}</style><h1>Подключение Telegram</h1><p>Введите SETUP_KEY, сохранённый в Cloudflare. Токен BotFather здесь не нужен.</p><form method="post" action="/setup"><input type="password" name="key" aria-label="SETUP_KEY" required autocomplete="off"><button>Подключить Telegram</button></form></html>`,{headers:{...headers,"Content-Type":"text/html; charset=utf-8","Content-Security-Policy":"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"}})}
async function equal(a,b){
 const enc=new TextEncoder();
 const [x,y]=await Promise.all([a,b].map(v=>crypto.subtle.digest("SHA-256",enc.encode(v))));
 const l=new Uint8Array(x),r=new Uint8Array(y);let diff=0;
 for(let i=0;i<l.length;i++)diff|=l[i]^r[i];return diff===0;
}
async function webhookSecret(key){
 const hash=await crypto.subtle.digest("SHA-256",new TextEncoder().encode("freebie-webhook:"+key));
 return [...new Uint8Array(hash)].map(v=>v.toString(16).padStart(2,"0")).join("");
}
class ApiError extends Error{
 constructor(method,code){super(method+": "+code);this.code=code}
}
async function api(env,method,data){
 const response=await fetch("https://api.telegram.org/bot"+env.BOT_TOKEN+"/"+method,{
  method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(data),
  signal:AbortSignal.timeout(10000)
 });
 const result=await response.json();
 if(!response.ok||!result.ok)throw new ApiError(method,result.error_code||response.status);
 return result.result;
}
async function handle(update,env){
 const m=update.message;
 if(m?.chat?.type==="private"&&/^\/start(?:@\w+)?(?:\s|$)/.test(m.text||"")){
  await api(env,"sendMessage",{chat_id:m.chat.id,text:"Выберите токен. Сейчас доступен тест KITO с демонстрационными данными.",reply_markup:menu});
 }
 const q=update.callback_query;
 if(!q)return;
 // Acknowledgment failure must not prevent the requested action.
 try{await api(env,"answerCallbackQuery",{callback_query_id:q.id})}catch{}
 if(q.message?.chat?.type!=="private")return;
 const chat_id=q.message.chat.id;
 if(q.data==="menu")await api(env,"sendMessage",{chat_id,text:"Выберите токен:",reply_markup:menu});
 if(q.data==="kito"){
  try{await api(env,"sendWidget",{chat_id,html:WIDGET_HTML,caption:"KITO — ДЕМО. Все числа и график вымышленные.",reply_markup:cardButtons})}
  catch(e){
   if(!(e instanceof ApiError)||e.code>=500||e.code===429)throw e;
   await api(env,"sendMessage",{chat_id,text:"Telegram не принял виджет ("+e.message+"). Отправьте этот текст разработчику."});
  }
 }
 if(q.data==="refresh")await api(env,"editMessageWidgetData",{chat_id,message_id:q.message.message_id,chat_data:JSON.stringify({checked:new Date().toISOString()})});
}
// Best-effort duplicate suppression within an isolate; not durable across restarts.
const completed=new Map();
export default {
 async fetch(request,env){
  const url=new URL(request.url);
  if(url.pathname==="/"||url.pathname==="/health")return text("Freebie: обработчик работает. Версия github-v1. Подключение: /setup");
  if(!["/setup","/webhook"].includes(url.pathname))return text("Страница не найдена.",404);
  if(!env.BOT_TOKEN||!env.SETUP_KEY)return text("В Cloudflare должны быть секреты BOT_TOKEN и SETUP_KEY.",503);
  if(url.pathname==="/setup"){
   if(request.method==="GET")return page();
   if(request.method!=="POST")return text("Используйте форму /setup.",405);
   // Authenticate the form with SETUP_KEY. Do not depend on fragile Origin headers.
   if(!request.headers.get("Content-Type")?.startsWith("application/x-www-form-urlencoded"))return text("Откройте /setup и отправьте форму.",415);
   const raw=await request.text();if(raw.length>4096)return text("Слишком большой запрос.",413);
   const key=new URLSearchParams(raw).get("key")||"";
   if(!await equal(key,env.SETUP_KEY))return text("Неверный SETUP_KEY. Используйте значение секрета из Cloudflare.",403);
   let base;
   try{base=new URL(env.PUBLIC_BASE_URL);if(base.protocol!=="https:")throw new Error()}catch{return text("Проверьте PUBLIC_BASE_URL в настройках.",503)}
   try{
    await api(env,"setWebhook",{url:base.origin+"/webhook",secret_token:await webhookSecret(env.SETUP_KEY),allowed_updates:["message","callback_query"],max_connections:1});
    const info=await api(env,"getWebhookInfo",{});
    if(info.url!==base.origin+"/webhook")return text("Адрес webhook не совпал. Повторите подключение.",502);
    return text("Telegram подключён. Отправьте /start боту, затем нажмите KITO.");
   }catch(e){return text(e instanceof ApiError?"Ошибка Telegram: "+e.message:"Telegram временно недоступен. Повторите подключение.",502)}
  }
  if(request.method!=="POST")return text("Это служебный адрес Telegram. Для подключения откройте /setup.",405);
  if(!await equal(request.headers.get("X-Telegram-Bot-Api-Secret-Token")||"",await webhookSecret(env.SETUP_KEY)))return text("Не подтверждён источник запроса Telegram.",403);
  let update;try{update=await request.json()}catch{return text("Некорректный JSON.",400)}
  if(!Number.isSafeInteger(update?.update_id))return text("Некорректный update_id.",400);
  if(completed.has(update.update_id))return text("OK");
  try{
   await handle(update,env);
   completed.set(update.update_id,true);
   if(completed.size>500)completed.delete(completed.keys().next().value);
   return text("OK");
  }catch(e){
   console.error(e instanceof ApiError?e.message:"Telegram request failed");
   // Permanent errors should not create an infinite Telegram retry loop.
   return e instanceof ApiError&&e.code<500&&e.code!==429?text("OK"):text("Temporary failure",503);
  }
 }
};
