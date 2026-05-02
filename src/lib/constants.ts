import type { AppMetadata } from '@siafoundation/sia-storage'

// biome-ignore format: long hex literal
export const APP_KEY = '38d69456b8f16d3d99dde67643ea55fd1dfbd2ae65dae904511531c2dc2aaaa6'
export const APP_NAME = 'timeloop-sia'
export const DEFAULT_INDEXER_URL = 'https://sia.storage'
export const APP_META: AppMetadata = {
  appId: APP_KEY,
  name: APP_NAME,
  description: 'A Sia storage app',
  serviceUrl: 'https://sia.storage',
  logoUrl: undefined,
  callbackUrl: undefined,
}

// Erasure coding parameters — passed to sdk.upload() and encodedSize().
export const DATA_SHARDS = 10
export const PARITY_SHARDS = 20
