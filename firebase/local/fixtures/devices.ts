// Canonical device fixture data is consumed by the ingestion service Emulator
// test helper. It intentionally contains no owner or claim relationship.
export const DEVICE_FIXTURES = [
  { deviceId: 'PC-000001', productModel: 'pc-mini', ingestionStatus: 'enabled' },
  { deviceId: 'PC-000002', productModel: 'pc-mini', ingestionStatus: 'disabled' },
  { deviceId: 'PC-000003', productModel: 'pc-pro', ingestionStatus: 'enabled' },
] as const;
