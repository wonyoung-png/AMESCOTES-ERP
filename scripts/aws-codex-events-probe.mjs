// Emits event structure only, never prompt/model text/authentication.
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {spawn} from 'node:child_process';
const dir=await mkdtemp('/tmp/ames-events-');
try {
 const schema=dir+'/schema.json';
 await writeFile(schema,JSON.stringify({type:'object',properties:{ok:{type:'boolean'}},required:['ok'],additionalProperties:false}),{mode:0o600});
 const child=spawn('codex',['exec','-s','read-only','-m','gpt-6.1-sol','-c','model_reasoning_effort=high','--ignore-user-config','--ignore-rules','--ephemeral','--disable','shell_tool','--disable','unified_exec','--disable','plugins','--disable','remote_plugin','--disable','hooks','--disable','enable_mcp_apps','-c','web_search="disabled"','--json','--skip-git-repo-check','-C',dir,'--output-schema',schema,'-o',dir+'/out.json','-'],{stdio:['pipe','pipe','pipe']});
 let out='',err='';child.stdout.on('data',s=>out+=s);child.stderr.on('data',s=>err+=s);
 child.stdin.end('Return {"ok":true}. Do not use any tools.');
 const code=await new Promise(r=>child.on('close',r));
 const events=[];let invalid=0;
 for(const line of out.trim().split('\n').filter(Boolean)) {try{const e=JSON.parse(line);events.push({keys:Object.keys(e),type:/^[a-z._]{1,40}$/.test(e.type||'')?e.type:'other',itemType:/^[a-z._]{1,40}$/.test(e.item?.type||'')?e.item.type:undefined});}catch{invalid++;}}
 console.log(JSON.stringify({code,events,invalid,stderrPresent:!!err}));
} finally {await rm(dir,{recursive:true,force:true});}
