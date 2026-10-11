import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { emptyListing, validateListing, cafe24FilterTags, type ListingImage } from '../shared/product-registration.js';

function fixture() {
  const listing = { ...emptyListing('synthetic-item'), sku: 'TEST-ONLY', style_name: 'LOG MIDDLE BAG', color_en: 'BROWN', name_ko: 'LOG MIDDLE BAG (BROWN)', name_en: 'LOG MIDDLE BAG (BROWN)', season: '26FW',
    price_krw: 100, price_usd: 100, supply_price: 20, weight_g: 200, summary_ko: '설명', simple_ko: '설명', detail_html_ko: '<p>제품</p>', desc_en: 'Product', desc_ja: '製品', details_en: 'Information', details_ja: '情報', care_ko: '관리',
    taxonomy_category_id: 'gid://shopify/TaxonomyCategory/example', meta_desc_ko: '설명', meta_desc_en: 'Description', meta_keywords: '가방', handle: 'test-only-brown', origin_cafe24: 'CN', origin_shopify: 'CN', hscode: '420221',
    cafe24_category_nos: [1], shopify_collection_ids: ['gid://shopify/Collection/1'], tags_ko: ['테스트'], tags_en: ['TEST'], cafe24_shipping: { shipping_fee_type: 'T' }, material: 'COW_LEATHER', color: 'BROWN', size: 'MEDIUM', design: 'SHOULDER' };
  const images: ListingImage[] = [0, 1, 2].map(position => ({ id: String(position), listing_id: 'synthetic', position, role: position ? 'extra' : 'main', source_url: 'https://example.invalid/test.jpg', width: 750, height: 1000, alt_en: 'Test', alt_ko: '테스트' }));
  return { listing, images };
}
test('all required channel fields and independent stock pass without changing item facts', () => {
  const { listing, images } = fixture(); listing.cafe24_qty = 0; listing.shopify_qty = 7;
  assert.deepEqual(validateListing(listing, images), []);
});
test('customer-visible 26FW is rejected but functional season and tags are permitted', () => {
  const { listing, images } = fixture(); listing.desc_en = '26FW collection';
  assert.ok(validateListing(listing, images).some(x => x.field === 'desc_en'));
  listing.desc_en = '26AW collection'; assert.deepEqual(validateListing(listing, images), []);
});
test('KRW and USD prices must each be positive and finite', () => {
  const { listing, images } = fixture(); listing.price_usd = NaN; listing.price_krw = 0;
  assert.deepEqual(validateListing(listing, images).filter(x => x.field.startsWith('price_')).map(x => x.field).sort(), ['price_krw','price_usd']);
});
test('one main image, 3:4, alt and 10MB limits are validated', () => {
  const { listing, images } = fixture(); images[1].role = 'main'; images[2].width = 1000; images[2].alt_en = ''; images[2].byte_size = 10485761;
  assert.equal(validateListing(listing, images).filter(x => x.field === 'images').length, 4);
  assert.equal(validateListing(listing, images).filter(x => x.severity === 'warning').length, 1);
});
test('channel product names must be identical uppercase MODEL (COLOR)', () => {
  const { listing, images } = fixture(); listing.name_en = 'Log middle';
  assert.ok(validateListing(listing, images).some(x => x.field === 'name_en'));
});
test('known size master conflicts block approval, not silently corrected', () => {
  const { listing, images } = fixture(); assert.ok(validateListing(listing, images, { 'LOG MIDDLE BAG': { size: '라지' } }).some(x => x.field === 'size'));
});
test('abbreviated model key resolves BAG master and blank master is blocked', () => {
  const { listing, images } = fixture(); listing.style_name = 'LOG MIDDLE';
  assert.deepEqual(validateListing(listing, images, { 'LOG MIDDLE BAG': { size: '미디엄' } }), []);
  assert.ok(validateListing(listing, images, { 'LOG MIDDLE BAG': { size: '' } }).some(x => x.field === 'size'));
});
test('due publish timestamp does not invalidate approved content', () => {
  const { listing, images } = fixture(); listing.publish_at = '2020-01-01T00:00:00Z';
  assert.deepEqual(validateListing(listing, images), []);
});
test('CEO-prohibited search tags cannot be restored by registration', () => {
  const { listing, images } = fixture(); listing.tags_ko = ['통근백'];
  assert.ok(validateListing(listing, images).some(x => x.field === 'tags_ko'));
});
test('preorder requires ship date and positive optional limit', () => {
  const { listing, images } = fixture(); listing.preorder_enabled = true; listing.preorder_limit = -1;
  assert.ok(validateListing(listing, images).some(x => x.field === 'preorder_ship_date'));
  assert.ok(validateListing(listing, images).some(x => x.field === 'preorder_limit'));
});
test('active HTML and price-based copy are blocked', () => {
  const { listing, images } = fixture(); listing.desc_ja = '<img onerror="alert(1)">'; listing.care_ko = 'MADE IN CHINA'; listing.summary_ko = '최저가';
  assert.ok(validateListing(listing, images).some(x => x.field === 'desc_ja'));
  assert.ok(validateListing(listing, images).some(x => x.field === 'care_ko'));
  assert.ok(validateListing(listing, images).some(x => x.field === 'summary_ko'));
});
test('Cafe24 filter values remove underscores while preserving shared identifiers', () => {
  const { listing } = fixture(); const tags = cafe24FilterTags(listing);
  assert.ok(tags.includes('COWLEATHER')); assert.ok(tags.includes('MATERIALALL')); assert.ok(tags.every(t => !t.includes('_'))); assert.equal(listing.material, 'COW_LEATHER');
});
test('migration is additive, server-only and approval revision is enforced', () => {
  const sql = readFileSync(new URL('../db/15_product_registration.sql', import.meta.url), 'utf8');
  assert.doesNotMatch(sql, /DROP\s+(TABLE|COLUMN)|DELETE\s+FROM\s+(items|public.items)/i);
  assert.match(sql, /approved_by <> created_by/); assert.match(sql, /approved_revision = revision/);
  assert.match(sql, /REVOKE ALL ON TABLE public/); assert.match(sql, /rolname=role_name/);
  assert.match(sql, /revision=p_revision AND \(lease_until IS NULL OR lease_until<now\(\)\)/);
});
