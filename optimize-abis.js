const fs = require('fs')
const equal = require('fast-deep-equal')

/**
 * Optimize the contracts directory by removing duplicate
 * ABIs, and replacing the duplicate with a pointer to 
 * the original (root ABI)
 */
async function optimizeAbis () {
  const versionDirs = fs.readdirSync('./contracts')
  
  // For each version (skipping the first)
  for (let i = 1; i < versionDirs.length; ++i) {
    const version = versionDirs[i]
    const prevVersion = versionDirs[i - 1]

    // For each ABI
    const abis = fs.readdirSync(`./contracts/${version}`)
    for (const abi of abis) {
      try {
        const abiJson = JSON.parse(fs.readFileSync(`./contracts/${version}/${abi}`, 'utf-8'))
        let rootVersion = prevVersion
        let rootAbiJson = JSON.parse(fs.readFileSync(`./contracts/${rootVersion}/${abi}`, 'utf-8'))

        if (rootAbiJson.rootVersion) {
          rootVersion = rootAbiJson.rootVersion
          rootAbiJson = JSON.parse(fs.readFileSync(`./contracts/${rootVersion}/${abi}`, 'utf-8'))
        }

        // Check to see if they're the same
        if (equal(abiJson, rootAbiJson)) {
          // Replace the duplicate with a "Root ABI Pointer"
          fs.writeFileSync(
            `./contracts/${version}/${abi}`,
            JSON.stringify({ rootVersion })
          )
        }
      } catch (e) { /* Do nothing because this is a newly added ABI */ }
    }
  }
}

if (require.main === module) {
  optimizeAbis()
    .catch(err => {
      console.log(err)
      process.exit(1)
    })
} else {
  module.exports = optimizeAbis
}
