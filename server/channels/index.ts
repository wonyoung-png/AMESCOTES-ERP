import { Channel, Listing, ListingImage, ValidationIssue } from '../../shared/product-registration';
import { assertWrites, errorCode, runtime, type ChannelResult, type ChannelResults, type OnStep, type Runtime } from './common';
import { cafe24Adapter } from './cafe24';
import { shopifyAdapter } from './shopify';
import { registrationStore, type RegistrationStore } from './settings';
import type { TokenStore } from './cafe24-auth';

export type { OnStep, ChannelResults, ChannelResult, StepEvent } from './common';
export { readMonitorSnapshot,createMonitorReader } from './monitor';
export function createChannelService(overrides: Partial<Runtime> = {}, store: RegistrationStore = registrationStore, tokens?: TokenStore) {
  const rt = runtime(overrides); const cafe24 = cafe24Adapter(rt,store,tokens); const shopify = shopifyAdapter(rt,store);
  const adapters = {cafe24,shopify};
  const writesEnabled = () => rt.env.PRODUCT_REGISTRATION_WRITES_ENABLED === 'true';
  async function run(listing: Listing, channels: Channel[], onStep: OnStep, operation: (channel: Channel, progress: OnStep) => Promise<Partial<ChannelResult>>): Promise<ChannelResults> {
    const results: ChannelResults = {};
    // Separate channel failures; a successful channel is not rolled back by the other channel.
    for (const channel of [...new Set(channels)]) {
      const steps: string[] = [];
      const progress: OnStep = async event => { await onStep(event); if (!event.step.endsWith(':intent')) steps.push(event.step); };
      try { assertWrites(rt); results[channel] = {ok:true,steps,...await operation(channel,progress)}; }
      catch (error) { results[channel] = {ok:false,steps,error:errorCode(error)}; }
    }
    return results;
  }
  return {
    async channelStatus() {
      return {cafe24:{connected:cafe24.configured(),writes_enabled:writesEnabled()},shopify:{connected:shopify.configured(),writes_enabled:writesEnabled()}};
    },
    async checkListing(listing: Listing): Promise<{issues: ValidationIssue[]}> {
      const issues: ValidationIssue[] = [];
      for (const channel of ['cafe24','shopify'] as const) {
        try { await adapters[channel].check(listing); }
        catch (error) { issues.push({field:`${channel}_connection`,message:errorCode(error),severity:'error'}); }
      }
      return {issues};
    },
    syncListing(listing: Listing,images: ListingImage[],onStep: OnStep) {
      return run(listing,listing.publish_channels,onStep,async (channel,progress) => ({id:await adapters[channel].sync(listing,images,progress)}));
    },
    publishListing(listing: Listing,channels: Channel[],onStep: OnStep) {
      return run(listing,channels,onStep,async (channel,progress) => ({id:await adapters[channel].publish(listing,progress)}));
    },
    endPreorder(listing: Listing,_images: ListingImage[],onStep: OnStep) {
      return run(listing,listing.publish_channels,onStep,async(channel,progress)=>({id:await adapters[channel].endPreorder(listing,progress)}));
    },
    deleteTestListing(listing: Listing,images: ListingImage[],onStep: OnStep) {
      return run(listing,listing.publish_channels,onStep,async (channel,progress) => {
        if (channel === 'cafe24') {
          const pending = await cafe24.remove(listing,images,progress);
          return pending.length ? {ok:false,pending_manual:pending,error:'manual_cleanup_required'} : {};
        }
        await shopify.remove(listing,images,progress); return {};
      });
    },
    async uploadListingImage(buffer: Buffer,mime: string,name: string) { assertWrites(rt); return shopify.upload(buffer,mime,name); },
    // Read-only adapters for rule-based monitoring; no model or merchant mutation is needed.
    async inspectListing(listing: Listing) {
      const result: Partial<Record<Channel,{product?:unknown;error?:string}>> = {};
      for (const channel of ['cafe24','shopify'] as const) {
        try { result[channel] = {product:channel==='cafe24' ? listing.cafe24_product_no ? await cafe24.product(listing.cafe24_product_no) : null : listing.shopify_product_id ? await shopify.client.product(listing.shopify_product_id) : null}; }
        catch(error) { result[channel] = {error:errorCode(error)}; }
      }
      return result;
    },
  };
}
// Lazy construction: importing the route never connects to a database or merchant API.
let defaultService: ReturnType<typeof createChannelService> | undefined;
const service = () => defaultService ||= createChannelService();
export const channelStatus = () => service().channelStatus();
export const checkListing = (listing: Listing) => service().checkListing(listing);
export const syncListing = (listing: Listing,images: ListingImage[],onStep: OnStep) => service().syncListing(listing,images,onStep);
export const publishListing = (listing: Listing,channels: Channel[],onStep: OnStep) => service().publishListing(listing,channels,onStep);
export const endPreorder = (listing: Listing,images: ListingImage[],onStep: OnStep) => service().endPreorder(listing,images,onStep);
export const deleteTestListing = (listing: Listing,images: ListingImage[],onStep: OnStep) => service().deleteTestListing(listing,images,onStep);
export const uploadListingImage = (buffer: Buffer,mime: string,name: string) => service().uploadListingImage(buffer,mime,name);
export const inspectListing = (listing: Listing) => service().inspectListing(listing);
