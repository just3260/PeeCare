import { getAsset, getAssetKeys } from 'node:sea'

import {
  createRuntimeAssetProvider,
  loadTestToolAssets,
} from './test-tool.mjs'
import {
  createDefaultOperatorDependencies,
  runTestToolOperator,
} from './test-tool-operator.mjs'

const EXPECTED_ASSET_KEYS = ['dog.png', 'machine.png', 'test-tool.html']

async function main() {
  const embeddedKeys = getAssetKeys().sort()
  if (JSON.stringify(embeddedKeys) !== JSON.stringify(EXPECTED_ASSET_KEYS)) {
    throw new Error('embedded_asset_inventory_invalid')
  }

  const assets = loadTestToolAssets(
    createRuntimeAssetProvider({
      sea: true,
      getAsset,
    }),
  )
  const manifest = Object.freeze({
    architecture: __PEECARE_ARCHITECTURE__,
    minimumMacOS: __PEECARE_MINIMUM_MACOS__,
  })

  await runTestToolOperator({
    args: process.argv.slice(2),
    environment: process.env,
    manifest,
    dependencies: createDefaultOperatorDependencies({
      environment: process.env,
      assets,
    }),
    writeEvent: (event) => console.log(JSON.stringify(event)),
  })
}

main().catch(() => {
  process.exitCode = 1
})
