import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';

test('real reviewer settings component guards staff, preserves failed draft, locks duplicate saves and refreshes shared context',async()=>{
 const h={states:[],cursor:0,context:{actorId:'boss',isBoss:true,ready:true,reviewerId:'boss'},people:[{id:'lead@example.invalid',name:'Test Lead',team:'제품개발'},{id:'other',name:'Other',team:'MD'}],success:[],errors:[],enabled:[],queries:[]};
 globalThis.__reviewerSettingsTest=h;const savedFetch=globalThis.fetch;
 try{
  const result=await build({entryPoints:[fileURLToPath(new URL('./SampleReviewerSettings.tsx',import.meta.url))],bundle:true,write:false,platform:'node',format:'esm',jsx:'automatic',plugins:[{name:'mock',setup(b){
   b.onResolve({filter:/^(react|@|sonner)/},args=>({path:args.path,namespace:'mock'}));
   b.onLoad({filter:/.*/,namespace:'mock'},({path})=>{
    let contents;
    if(path==='react')contents=`const h=globalThis.__reviewerSettingsTest;export const useState=i=>{const n=h.cursor++;if(!(n in h.states))h.states[n]=i;return[h.states[n],v=>h.states[n]=v]};export const useRef=i=>{const n=h.cursor++;if(!(n in h.states))h.states[n]={current:i};return h.states[n]};`;
    else if(path==='react/jsx-runtime')contents='export const jsx=(type,props)=>({type,props});export const jsxs=jsx;';
    else if(path==='@tanstack/react-query')contents=`const h=globalThis.__reviewerSettingsTest;export const useQueryClient=()=>({setQueryData:(key,value)=>{h.queries.push(key);h.context=value}});export const useQuery=o=>{h.enabled.push(o.enabled);return {data:o.queryKey[0]==='sample-workflow-context'?h.context:{items:h.people},isPending:o.queryKey[0]!=='sample-workflow-context'&&!!h.directoryPending,isError:false,refetch(){}}};`;
    else if(path.endsWith('/button'))contents='export const Button="button";';
    else if(path.endsWith('/label'))contents='export const Label="label";';
    else if(path==='sonner')contents='const h=globalThis.__reviewerSettingsTest;export const toast={success:x=>h.success.push(x),error:x=>h.errors.push(x)};';
    else throw Error(path);return {contents,loader:'js'};
   });
  }}]});
  const {default:Component}=await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
  const render=()=>{h.cursor=0;return Component();};
  const nodes=x=>!x||typeof x!=='object'?[]:Array.isArray(x)?x.flatMap(nodes):[x,...nodes(x.props?.children)];
  const picker=tree=>nodes(tree).find(n=>n.props?.id==='sample-reviewer-setting');
  const save=tree=>nodes(tree).find(n=>n.type==='button'&&n.props.children==='담당자 저장');
  h.context.isBoss=false;assert.equal(render(),null);assert.equal(h.enabled.at(-1),false);h.context.isBoss=true;
  h.directoryPending=true;let loading=render();assert.ok(!nodes(loading).some(n=>n.type==='option'&&n.props.children==='현재 담당 계정 확인 필요'));h.directoryPending=false;
  h.context.ready=false;h.context.reviewerInvalid=true;assert.equal(picker(render()).props.disabled,false);h.context.ready=true;delete h.context.reviewerInvalid;
  let tree=render();assert.ok(!nodes(tree).some(n=>n.type==='option'&&n.props.value==='other'));
  picker(tree).props.onChange({target:{value:'lead@example.invalid'}});tree=render();assert.equal(save(tree).props.disabled,false);
  const calls=[];globalThis.fetch=async(url,init)=>{calls.push({url,init});return {ok:false,status:403,json:async()=>({error:'forbidden'})}};
  await save(tree).props.onClick();assert.equal(h.success.length,0);assert.equal(picker(render()).props.value,'lead@example.invalid');
  let release;globalThis.fetch=async(url,init)=>{calls.push({url,init});await new Promise(r=>release=r);return {ok:true,status:200,json:async()=>({...h.context,reviewerId:'lead@example.invalid'})}};
  const action=save(render()).props.onClick;const first=action();const second=action();assert.equal(calls.length,2);release();await Promise.all([first,second]);
  assert.equal(h.success.length,1);assert.deepEqual(h.queries,[['sample-workflow-context']]);
  assert.equal(JSON.parse(calls[1].init.body).reviewerId,'lead@example.invalid');assert.equal(calls[1].init.credentials,'include');
 }finally{globalThis.fetch=savedFetch;delete globalThis.__reviewerSettingsTest;}
});
