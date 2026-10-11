/** PREPARE ONLY. Default is read-only CSV on stdout. No dotenv/token-file/MCP token loading. */
import { pathToFileURL } from 'node:url';
import { FILTER_CODES } from '../shared/product-registration';
import { cafe24Adapter, BANNED_CAFE24_TAGS } from '../server/channels/cafe24';
import { runtime, assertWrites, ChannelError } from '../server/channels/common';
import { registrationStore, type ChannelSettings } from '../server/channels/settings';

export function verifiedAliases(settings: ChannelSettings) {
  const aliases: Record<string,string> = {};
  for (const field of ['material','color','size','design'] as const) {
    aliases[`${field.toUpperCase()}_ALL`] = `${field.toUpperCase()}ALL`;
    for (const [code,candidate] of Object.entries(FILTER_CODES[field])) {
      const saved = settings.filter_mappings?.[field]?.[code];
      if (saved?.verified === true && saved.cafe24 === candidate.cafe24) aliases[code] = candidate.cafe24;
    }
  }
  return aliases;
}
export const additions = (tags: string[], aliases: Record<string,string>) => [...new Set(tags.filter(tag=>!BANNED_CAFE24_TAGS.includes(tag))
  .map(tag=>aliases[tag]).filter((tag):tag is string=>!!tag&&!tags.includes(tag)))];
const csv = (value: unknown) => `"${String(value??'').replace(/"/g,'""')}"`;
export async function migrate(args: string[] = process.argv.slice(2)) {
  if (args.some(arg=>!['--apply','--labels'].includes(arg))) throw new ChannelError('unsupported_migration_argument');
  const rt=runtime();const apply=args.includes('--apply');
  if(apply) assertWrites(rt);
  const aliases=verifiedAliases(await registrationStore.settings());
  if(args.includes('--labels')) {
    // Generate this JSON from the canonical shared table, never maintain a second code table.
    process.stdout.write(JSON.stringify(Object.fromEntries(Object.entries(aliases).map(([old,code])=>[code,old.replaceAll('_',' ')])),null,2)+'\n');return;
  }
  const cafe=cafe24Adapter(rt,registrationStore,undefined,!apply);
  process.stdout.write('product_no,existing_tags,added_tags,status\n');
  let since=0;
  for(let page=0;page<10000;page++) {
    const data=await cafe.api(`/products?shop_no=1&limit=100&since_product_no=${since}`);
    const products=data?.products;
    if(!Array.isArray(products)) throw new ChannelError('migration_invalid_response');
    if(!products.length)return;
    for(const product of products) {
      const tags=product.product_tag;
      if(!Array.isArray(tags)) throw new ChannelError('migration_tags_not_read');
      const add=additions(tags,aliases);let status=apply?'unchanged':'dry_run';
      if(apply && add.length) {
        await cafe.api(`/products/${product.product_no}/tags`,'POST',{tags:add},true);
        // Do not issue a second POST after an eventually consistent read miss.
        await rt.sleep(60_000);let verified=false;
        for(let poll=0;poll<7;poll++) {
          const actual=(await cafe.api(`/products/${product.product_no}?shop_no=1&fields=product_tag`))?.product?.product_tag||[];
          if(add.every(tag=>actual.includes(tag))){verified=true;break;}
          if(poll<6)await rt.sleep(5000);
        }
        status=verified?'added_verified':'pending_verification';
      }
      process.stdout.write([product.product_no,tags.join('|'),add.join('|'),status].map(csv).join(',')+'\n');
    }
    const next=Math.max(...products.map((p:any)=>Number(p.product_no)));
    if(!Number.isInteger(next)||next<=since)throw new ChannelError('migration_pagination_stalled');
    since=next;
  }
  throw new ChannelError('migration_pagination_limit');
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) migrate().catch(()=>{process.stderr.write('Migration failed; no credentials or provider response logged.\n');process.exitCode=1;});
