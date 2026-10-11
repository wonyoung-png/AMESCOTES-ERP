// Every operation below is checked with the official Shopify schema validator (see README).
export const SHOPIFY_API_VERSION = '2026-10';
export const Q = {
  shop: `query RegistrationShop { shop { currencyCode primaryDomain { url } } }`,
  inventory: `query RegistrationInventory($id:ID!,$location:ID!) { inventoryItem(id:$id) { inventoryLevel(locationId:$location) { quantities(names:["available"]) { name quantity } } } }`,
  product: `query RegistrationProduct($id: ID!) { product(id:$id) { id title handle status vendor descriptionHtml tags category { id } seo { title description } onlineStoreUrl
    variants(first:100) { nodes { id sku barcode price taxable inventoryPolicy inventoryItem { id tracked countryCodeOfOrigin harmonizedSystemCode unitCost { amount currencyCode } measurement { weight { value unit } } } } pageInfo { hasNextPage } }
    media(first:100) { nodes { id alt ... on MediaImage { image { url } fileStatus } } pageInfo { hasNextPage } }
    collections(first:100) { nodes { id } pageInfo { hasNextPage } }
    metafields(first:100) { nodes { id namespace key type value } pageInfo { hasNextPage } }
    resourcePublicationsV2(first:100) { nodes { isPublished publication { id } } pageInfo { hasNextPage } }
  } }`,
  duplicates: `query RegistrationDuplicates($query:String!) { products(first:100,query:$query) { nodes { id handle tags variants(first:100) { nodes { sku } pageInfo { hasNextPage } } } pageInfo { hasNextPage } } }`,
  definitions: `query RegistrationDefinitions($after:String) { metafieldDefinitions(first:100,ownerType:PRODUCT,after:$after) { nodes { namespace key type { name } validations { name value } } pageInfo { hasNextPage endCursor } } }`,
  reference: `query RegistrationReference($id:ID!) { node(id:$id) { id ... on Metaobject { type definition { id } } ... on Product { title } ... on MediaImage { fileStatus image { url } } ... on Collection { ruleSet { appliedDisjunctively } } ... on Location { isActive } ... on Publication { name } ... on TaxonomyCategory { name } } }`,
  set: `mutation RegistrationSet($input:ProductSetInput!,$identifier:ProductSetIdentifiers) { productSet(input:$input,identifier:$identifier,synchronous:true) { product { id } userErrors { field message code } } }`,
  stage: `mutation RegistrationStage($input:[StagedUploadInput!]!) { stagedUploadsCreate(input:$input) { stagedTargets { url resourceUrl parameters { name value } } userErrors { field message } } }`,
  createFile: `mutation RegistrationFileCreate($files:[FileCreateInput!]!) { fileCreate(files:$files) { files { id fileStatus ... on MediaImage { image { url width height } } } userErrors { field message code } } }`,
  file: `query RegistrationFile($id:ID!) { node(id:$id) { id ... on MediaImage { fileStatus alt image { url width height } } } }`,
  findFile: `query RegistrationFindFile($query:String!) { files(first:100,query:$query) { nodes { id fileStatus ... on MediaImage { image { url width height } } } pageInfo { hasNextPage } } }`,
  attachFile: `mutation RegistrationFileUpdate($files:[FileUpdateInput!]!) { fileUpdate(files:$files) { files { id fileStatus } userErrors { field message code } } }`,
  order: `mutation RegistrationMediaOrder($id:ID!,$moves:[MoveInput!]!) { productReorderMedia(id:$id,moves:$moves) { job { id done } mediaUserErrors { field message code } } }`,
  job: `query RegistrationJob($id:ID!) { job(id:$id) { done } }`,
  meta: `mutation RegistrationMetafields($metafields:[MetafieldsSetInput!]!) { metafieldsSet(metafields:$metafields) { metafields { id namespace key value type } userErrors { field message code } } }`,
  metaDelete: `mutation RegistrationMetafieldDelete($metafields:[MetafieldIdentifierInput!]!) { metafieldsDelete(metafields:$metafields) { deletedMetafields { ownerId namespace key } userErrors { field message } } }`,
  translatable: `query RegistrationTranslatable($id:ID!) { translatableResource(resourceId:$id) { resourceId translatableContent { key value digest locale } translations(locale:"ja") { key value outdated } } }`,
  translate: `mutation RegistrationTranslate($id:ID!,$translations:[TranslationInput!]!) { translationsRegister(resourceId:$id,translations:$translations) { translations { key value } userErrors { field message } } }`,
  active: `mutation RegistrationActive($product:ProductUpdateInput!) { productUpdate(product:$product) { product { id status } userErrors { field message } } }`,
  policy: `mutation RegistrationPolicy($id:ID!,$variants:[ProductVariantsBulkInput!]!) { productVariantsBulkUpdate(productId:$id,variants:$variants) { productVariants { id inventoryPolicy } userErrors { field message code } } }`,
  publish: `mutation RegistrationPublish($id:ID!,$input:[PublicationInput!]!) { publishablePublish(id:$id,input:$input) { userErrors { field message } } }`,
  deleteFile: `mutation RegistrationDeleteFile($ids:[ID!]!) { fileDelete(fileIds:$ids) { deletedFileIds userErrors { field message code } } }`,
  deleteProduct: `mutation RegistrationDeleteProduct($input:ProductDeleteInput!) { productDelete(input:$input) { deletedProductId userErrors { field message } } }`,
  references: `query RegistrationAllReferences($after:String) { products(first:100,after:$after) { nodes { id media(first:100) { nodes { id } pageInfo { hasNextPage } } metafields(first:100) { nodes { type value } pageInfo { hasNextPage } } } pageInfo { hasNextPage endCursor } } }`,
} as const;
