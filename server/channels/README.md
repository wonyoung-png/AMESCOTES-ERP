# Product channel adapters — implementation and validation evidence

Prepared in `AMESCOTES-ERP-council`, branch `product-registration`. No merchant API,
database execution, deployment, commit or push was performed by this worker.
All channel tests use injected fetch/database/token mocks.

## Public contract

- `channelStatus()` reports configuration and the exact merchant write gate.
- `checkListing(listing)` reads duplicate SKU/handle, verified mapping, merchant definitions,
  references, manual collections, taxonomy, location and USD shop currency; errors block approval.
- `syncListing`, `deleteTestListing` honor `listing.publish_channels` (the caller's pending subset).
- `publishListing(listing,channels,onStep)` honors the explicit subset.
- `endPreorder(listing,images,onStep)` changes policy and label only. It never sends quantity,
  price, images, publication or visibility replacements. Authoritative expiry/receipt evidence is
  the caller's responsibility; positive inventory is NOT proof of receipt.
- `uploadListingImage(buffer,mime,name)` creates a fresh uniquely named staged Shopify File;
  returns source URL, file ID, dimensions, MIME and byte size after READY.
- `readMonitorSnapshot(listing,channel,signal)` implements `ShopMonitorReader`; abort/deadline
  reaches DB reads, fetches, throttle queues and retry waits. Actual missing/unavailable is distinct.
- `onStep({channel,step,key,data})` MUST persist with revision/lease-owner CAS before resolving.
  Intent is persisted before uncertain create, file and image operations. Envelopes
  `{data,step,completed_at}` and raw data are supported. Never erase create intents, file provenance
  or `inventory_initial` keys during reapply. Uncertain negative lookup blocks another create.
  Cafe24 main-image POSTs additionally retain a unique `main_image:...:upload:intent` attempt.
  The matching completed result resolves that attempt; an older completed result cannot resolve
  a newer lost response. Known response paths are persisted before verification and can recover
  without POST. Completed legacy/main provenance permits approved repair of admin image drift;
  an unresolved first upload remains blocked. Common `hasIntent` semantics are unchanged.

## Safety and normalization

- Merchant writes require `PRODUCT_REGISTRATION_WRITES_ENABLED === 'true'`; default OFF.
- OAuth refresh is a separate capability: `PRODUCT_REGISTRATION_OAUTH_REFRESH_ENABLED === 'true'`.
  Only the fixed ERP-app OAuth endpoint receives this capability. Merchant product writes remain
  gated OFF. DB `product_registration_token_claim` acquires a bounded 90-second lease;
  conditional PATCH matches `channel=cafe24_erp`, owner and an unexpired lease, rotates tokens and
  clears the lease. No MCP/shared app tokens are read. Lost rotating-token persistence requires
  operator reauthorization, never a blind OAuth retry.
- Cafe24 header is pinned to TASK version `2026-03-01`; calls are process-serialized at ≥500ms,
  including retry attempts. Tags settle for 60–90 seconds. Only formerly ERP-managed removed tags
  use `DELETE /products/{no}/tags/{tag}`; unrelated tags remain. Underscores are removed outbound.
- Shopify is pinned to `2026-10`; conflicting env version fails closed. Intl shop currency MUST
  be USD. Supply cost is KRW converted using configured `PRODUCT_REGISTRATION_KRW_PER_USD`;
  the adapter never guesses a rate. Quantity is initialized only on creation; reapproval updates
  omit quantity, preserve existing variant IDs and ACTIVE / display-selling state.
- Image identity is listing + image ID + original source, not listing revision. Removed ERP media
  are detached only from the ERP-owned product. Source files are never attached as product media.
  Unique staged resources, READY, filename provenance and all paginated product media/file-reference
  metafields are checked before file deletion; incomplete scans fail closed. ProductDelete is last.
- Cafe24 additional images are validated before any merchant mutation: at most 20, each actual
  source buffer at most 5 MiB, aggregate at most 30 MiB (ERP's 10 MiB upload limit does not override
  these channel limits). Errors explicitly identify count, per-file or aggregate limits.
  Changed sets use full-set PUT only when every existing path has durable ERP image provenance;
  zero extras use DELETE under the same ownership guard. Main images and physical source files
  are protected. Exact ordered response paths are persisted as `extra_images:response` before
  read-back; a failed read can recover without another upload. A previously completed key whose
  verification is false does not block a replay-safe owned PUT merely because its intent exists.
- Existing merchant-owned metafield/metaobject definitions are read and validated, never created
  or modified. Values use `metafieldsSet`; Japanese translations target body_html and
  custom.product_details only, with newly read digests. No Japanese title/SEO writes.
- Filter candidates are not confirmed production mappings. Saved settings must contain
  `filter_mappings[field][code]={verified:true,cafe24:<canonical tag>,shopify_ref:<existing GID>}`.
  Existing metaobjects must match the definition's allowed metaobject-definition ID.
- Shopify size is ERP bag-size-master validation, not an invented merchant custom metafield.
  Reader marks `unsupported:['filters.size']`; the monitor excludes that custom-ref comparison.
  Verified SIZE mapping therefore requires its canonical Cafe24 tag, not an unused Shopify GID.

## Actual official Shopify schema validation

The official skill `scripts/search_docs.mjs` was used before operation generation and for the
reported enum error. Official `scripts/validate.mjs` ran with `OPT_OUT_INSTRUMENTATION=true`,
`--api admin --version 2026-10 --artifact-id product-registration-channels`, model `gpt-6`,
client `codex/desktop`. These are schema-only requests, NOT merchant GraphQL calls.

| Revision | Actual result | Coverage |
|---|---|---|
| 1 | `success:true`, resolvedVersion `2026-10` | All then-existing Q variable-based documents |
| 2 | `success:false` | All updated Q, including inventory/policy, plus literal input fixtures; detected invalid `ERROR` file-create enum |
| 3 | `success:true`, resolvedVersion `2026-10` | All Q and representative generated inputs after official-doc correction to `RAISE_ERROR` |
| 4 | `success:true`, resolvedVersion `2026-10` | Final latest Q (including shop/policy/metaDelete) and all literal fixtures, rerun after review fixes |

Actual revision-3 resultDetail: `Successfully validated GraphQL query against schema.`
Informational deprecations: `Collection.ruleSet` (use sources in a future version),
`Publication.name` (future catalog title). Both are still valid in the pinned schema.
Validation includes `shop`, `policy`, `metaDelete`, stage/create/update/delete files, productSet,
inventory/location reads, reference scans, metadata, Japanese translations and publication.
The literal fixtures validate enum/input field values which variable-only documents cannot check.

Reproduce without shop credentials (PowerShell; documentation/schema service only):

```powershell
$env:OPT_OUT_INSTRUMENTATION='true'
# Use node --import tsx to import Q, join Object.values(Q), append the UTF-8 fixture,
# and pass the combined string as --code to the official validate.mjs script.
# --api admin --version 2026-10 --artifact-id product-registration-channels --revision 4 --json
```

No `log_feedback` was run here: the parent owns the final single feedback call.

## Tests and required deployment settings

`tsx --test server/product-channels.test.ts`: 53/53 passed with pure mocks (2026-10-11).
Coverage includes default-OFF gate, separate OAuth permission, 429/5xx, uncertain-create retries,
full two-channel staging, USD rejection regression, media identity, retained live stock on
reapproval, narrow preorder expiry, file deletion/reference preservation and real monitor readers.
Additional-image regressions cover edit/add/remove/reorder, zero-extra DELETE and re-add PUT,
external-path preservation, old completed intent recovery, persisted response proof after failed
read-back, unknown response paths failing closed, and all three pre-mutation channel limits.
Main-image regressions cover completed/legacy repair, first-upload uncertainty, newer unresolved
attempt isolation, durable response recovery, and SIZE mapping without an unused Shopify ref.

Required settings: merchant write gate, OAuth gate, ERP Cafe24 client ID/secret and separate DB
token row; Shopify shop domain/token, location ID, Online Store publication ID, KRW-per-USD rate;
existing Cafe24 `CAFE24_PREORDER_LABEL_KEY` matching `custom_optionN`; verified mapping settings.
`PRODUCT_REGISTRATION_FILE_DELETE_AUDITED=true` is an additional operator attestation for usage
outside product references before permanent deletion; it does not bypass the all-product scan.

## Explicit limitations / operator acceptance checks

1. Exact preorder hard caps are NOT implemented; configured limits block channel approval/sync.
   CONTINUE or negative stock plus polling cannot guarantee a cap. Proposed future mode needs an
   approved separate preorder allocation/checkout restriction, not invented physical stock.
2. Cafe24 owned additional-image replacement/removal is implemented, not a blanket manual gap.
   External/unproven additions remain blocked. An uncertain upload with unknown new paths and no
   durable response proof needs operator reconciliation; no count-only adoption or blind POST.
   Additional images use the documented embedded product read, not a guessed additionalimages GET.
3. Cafe24 trash purge/residual file removal stays explicit `pending_manual`, never deletion success.
4. The exact 2026-03-01 archived documentation URL was unavailable. Official legacy API describes
   use_inventory T/display_soldout F negative-stock selling, and current official support confirms
   semantics. Official 2025-12-01 documentation and current PUT/DELETE endpoint documentation
   corroborate additional-image replacement and its 20 / 5 MB / 30 MB limits; exact-version
   archival verification is not claimed. Requests remain pinned and results verified by read-back;
   the operator must
   acceptance-test zero-stock orderability/restoration on that version before enabling writes.
5. File-reference graph outside products is not exhaustive in this implementation; without the
   explicit usage audit attestation permanent deletion is blocked. Original ERP files remain.
6. Shopify product/definition/reference scans are bounded and refuse incomplete pagination; no
   silent partial-scan approval or destructive cleanup. Reconciliation after lost creates may need
   an operator if provider search indexing/filename processing has not settled.

## Official documentation used

- [Shopify productSet](https://shopify.dev/docs/api/admin-graphql/2026-10/mutations/productSet)
- [Staged uploads](https://shopify.dev/docs/api/admin-graphql/2026-10/mutations/stagedUploadsCreate)
- [File duplicate resolution](https://shopify.dev/docs/api/admin-graphql/2026-10/enums/FileCreateInputDuplicateResolutionMode)
- [Media ownership and file lifecycle](https://shopify.dev/docs/apps/build/product-merchandising/products-and-collections/manage-media)
- [Policy-only variant updates](https://shopify.dev/docs/api/admin-graphql/2026-10/mutations/productVariantsBulkUpdate)
- [MetafieldsSet](https://shopify.dev/docs/api/admin-graphql/2026-10/mutations/metafieldsSet)
- [TranslationsRegister](https://shopify.dev/docs/api/admin-graphql/2026-10/mutations/translationsRegister)
- [Cafe24 legacy API: inventory/image fields](https://partners.cafe24.com/docs/en/api/admin/)
- [Cafe24 negative-stock semantics](https://supportglobal.cafe24.com/hc/en-us/articles/4402074196761-Store-inventory)
- [Cafe24 inventory endpoint](https://apidocs.cafe24.com/docs/admin/put-products-by-product-no-variants-by-variant-code-inventories)
- [Cafe24 tag deletion](https://apidocs.cafe24.com/docs/admin/delete-products-by-product-no-tags-by-tag)
- [Cafe24 2025-12-01 additional-image requests and limits](https://developers.cafe24.com/docs/en/api/admin/?version=2025-12-01)
- [Cafe24 additional-image replacement](https://apidocs.cafe24.com/docs/admin/put-products-by-product-no-additionalimages)
- [Cafe24 additional-image deletion](https://apidocs.cafe24.com/docs/admin/delete-products-by-product-no-additionalimages)
- [Cafe24 API version header](https://apidocs.cafe24.com/en/docs/2026-06-01/guide/versioning)
