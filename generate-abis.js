const fs = require('fs')
const path = require('path')

/**
 * Fetch all abis from @daostack/arc into the `abis` folder.
 */
async function generateAbis (bases) {
  for (let i in bases) {
    let arcVersion = require('./package.json').dependencies['@daostack/arc']
    const base = require('path').dirname(require.resolve(bases[i]))
    if (!fs.existsSync('./abis/' + arcVersion)) {
      fs.mkdirSync('./abis/' + arcVersion)
    }
    const files = fs.readdirSync(base)
    files.forEach(file => {
      const abi = JSON.parse(fs.readFileSync(path.join(base, file), 'utf-8'))
        .abi
      fs.writeFileSync(
        path.join('./abis/' + arcVersion, file),
        JSON.stringify(abi, undefined, 2),
        'utf-8'
      )
    })
  }
}

if (require.main === module) {
  generateAbis([
    '@daostack/arc/build/contracts/UController.json',
    '@daostack/arc-hive/build/contracts/DAORegistry.json'
  ]).catch(err => {
    console.log(err)
    process.exit(1)
  })
} else {
  module.exports = generateAbis
}
