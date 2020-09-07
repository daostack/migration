const glob = require('glob')
const utils = require('./utils.js')

async function migrateBase ({ arcVersion, web3, confirm, opts, logTx, previousMigration, getArcVersionNumber, sendTx, optimizedAbis }) {
  let tx
  if (!(await confirm('About to migrate arc package. Continue?'))) {
    return
  }

  let contractsDir = 'contracts'
  if (optimizedAbis) {
    contractsDir = 'contracts-optimized'
  }

  const arcURL = `https://github.com/daostack/arc/releases/tag/${arcVersion}`

  const addresses = {}
  let network = await web3.eth.net.getNetworkType()
  if (network === 'main') {
    network = 'mainnet'
  } else if (network === 'private') {
    if (await web3.eth.net.getId() === 100) {
      network = 'xdai'
    } else if (await web3.eth.net.getId() === 77) {
      network = 'sokol'
    }
  }

  async function shouldDeploy (contractName, deployedBytecode, deps) {
    if (contractName !== 'ImplementationDirectory') {
      deps = deps || []
      for (let existing in previousMigration.package) {
        existing = previousMigration.package[existing]
        const sameDeps = deps.reduce((acc, dep) => addresses[dep] === existing[dep] && acc, true)

        const code = existing[contractName] && (await web3.eth.getCode(existing[contractName]))
        const sameCode = existing[contractName] && deployedBytecode === code

        if (
          contractName === 'GEN' &&
          existing[contractName] &&
          code !== '0x' &&
          (!(await confirm(`Found existing GEN (DAOToken) contract, Deploy new instance?`, false)) || network === 'private')
        ) {
          addresses[contractName] = existing[contractName]
          return existing[contractName]
        } else if (
          sameCode &&
          sameDeps &&
          !(await confirm(
            `Found existing '${contractName}' instance with same bytecode and ${
              !deps.length ? 'no ' : ''
            }dependencies on other contracts at '${existing[contractName]}'. Deploy new instance?`,
            false
          ))
        ) {
          addresses[contractName] = existing[contractName]
          return existing[contractName]
        }
      }
    }
  }
  async function deploy ({ contractName, abi, bytecode, deployedBytecode }, deps, ...args) {
    let existingAddress = await shouldDeploy(contractName, deployedBytecode, deps)
    if (existingAddress) {
      return existingAddress
    }
    let { receipt, result } = await sendTx(new web3.eth.Contract(abi, undefined, opts).deploy({
      data: bytecode,
      arguments: args
    }), `Migrating ${contractName}...`)
    await logTx(receipt, `${result.options.address} => ${contractName}`)
    addresses[contractName] = result.options.address
    return result.options.address
  }

  // OpenZeppelin App and Package setup
  let packageName = 'DAOstack'

  let Package = await deploy(utils.importAbi(`./${contractsDir}/${arcVersion}/Package.json`))
  let packageContract = new web3.eth.Contract(
    utils.importAbi(`./${contractsDir}/${arcVersion}/Package.json`).abi,
    Package,
    opts
  )

  if (await packageContract.methods.hasVersion([0, 1, getArcVersionNumber(arcVersion)]).call()) {
    if (!(
      await confirm(
        `Package ${packageName} version 0.1.${getArcVersionNumber(arcVersion)} already exists. Would you like to deploy a new Package contract?`,
        false
      )
    )) {
      return
    }
    delete previousMigration.package
    Package = await deploy(utils.importAbi(`./${contractsDir}/${arcVersion}/Package.json`))
    packageContract = new web3.eth.Contract(
      utils.importAbi(`./${contractsDir}/${arcVersion}/Package.json`).abi,
      Package,
      opts
    )
  }

  const ImplementationDirectory = await deploy(utils.importAbi(`./${contractsDir}/${arcVersion}/ImplementationDirectory.json`))
  let implementationDirectory = new web3.eth.Contract(
    utils.importAbi(`./${contractsDir}/${arcVersion}/ImplementationDirectory.json`).abi,
    ImplementationDirectory,
    opts
  )

  tx = (await sendTx(
    packageContract.methods.addVersion(
      [0, 1, getArcVersionNumber(arcVersion)],
      ImplementationDirectory,
      web3.utils.hexToBytes(web3.utils.utf8ToHex(arcURL))
    ), `Adding version 0.1.${getArcVersionNumber(arcVersion)} to ${packageName} Package`)
  ).receipt
  await logTx(tx, `Added version 0.1.${getArcVersionNumber(arcVersion)} to ${packageName} Package`)
  let App = await deploy(utils.importAbi(`./${contractsDir}/${arcVersion}/App.json`))
  let app = new web3.eth.Contract(
    utils.importAbi(`./${contractsDir}/${arcVersion}/App.json`).abi,
    App,
    opts
  )

  tx = (await sendTx(
    app.methods.setPackage(packageName, Package, [0, 1, getArcVersionNumber(arcVersion)]),
    `Setting App package to version 0.1.${getArcVersionNumber(arcVersion)}`)).receipt
  await logTx(tx, `App package version has been set to 0.1.${getArcVersionNumber(arcVersion)}`)

  // Setup the GEN token contract
  let GENToken = '0x543Ff227F64Aa17eA132Bf9886cAb5DB55DCAddf'

  if (network === 'private') {
    GENToken = await deploy({ ...utils.importAbi(`./${contractsDir}/${arcVersion}/DAOToken.json`), contractName: 'GEN' })

    const GENTokenContract = new web3.eth.Contract(
      utils.importAbi(`./${contractsDir}/${arcVersion}/DAOToken.json`).abi,
      GENToken,
      opts
    )

    if (!((await GENTokenContract.methods.symbol().call()) === 'GEN')) {
      tx = (
        await sendTx(GENTokenContract.methods.initialize(
          'DAOstack',
          'GEN',
          web3.utils.toWei('100000000'),
          web3.eth.defaultAccount),
        'Initializing GEN...')).receipt
      await logTx(tx, 'Finished initializing GEN')
    }

    web3.eth.accounts.wallet.clear()

    let privateKeys = [
      '0x4f3edf983ac636a65a842ce7c78d9aa706d3b113bce9c46f30d7d21715b23b1d',
      '0x6cbed15c793ce57650b9877cf6fa156fbef513c4e6134f022a85b1ffdd59b2a1',
      '0x6370fd033278c143179d81c5526140625662b8daa446c22ee2d73db3707e620c',
      '0x646f1ce2fdad0e6deeeb5c7e8e5543bdde65e86029e2fd9fc169899c440a7913',
      '0xadd53f9a7e588d003326d1cbf9e4a43c061aadd9bc938c843a79e7b4fd2ad743',
      '0x395df67f0c2d2d9fe1ad08d1bc8b6627011959b79c53d7dd6a3536a33ab8a4fd',
      '0xe485d098507f54e7733a205420dfddbe58db035fa577fc294ebd14db90767a52',
      '0xa453611d9419d0e56f499079478fd72c37b251a94bfde4d19872c44cf65386e3',
      '0x829e924fdf021ba3dbbc4225edfece9aca04b929d6e75613329ca6f1d31c0bb4',
      '0xb0057716d5917badaf911b193b12b910811c1497b5bada8d7711f758981c3773'
    ]

    for (let i = 0; i < privateKeys.length; i++) {
      web3.eth.accounts.wallet.add(web3.eth.accounts.privateKeyToAccount(privateKeys[i]))
      tx = (
        await sendTx(
          GENTokenContract.methods.mint(
            web3.eth.accounts.wallet[i].address,
            web3.utils.toWei('1000')
          ),
          `Minting 1000 GEN to test account: ${web3.eth.accounts.wallet[i].address}`
        )
      ).receipt
      await logTx(tx, `Minted 1000 GEN to test account: ${web3.eth.accounts.wallet[i].address}`)
    }
  } else {
    addresses['GEN'] = GENToken
  }

  const files = glob.sync(`./contracts/${arcVersion}/*.json`, {
    nodir: true
  })

  const arcPackageContracts = [
    'Agreement',
    'Auction4Reputation',
    'Avatar',
    'Competition',
    'ContinuousLocking4Reputation',
    'ContributionReward',
    'ContributionRewardExt',
    'Controller',
    'ControllerUpgradeScheme',
    'DAOFactory',
    'DAORegistry',
    'DAOToken',
    'Dictator',
    'ExternalLocking4Reputation',
    'FixedReputationAllocation',
    'FundingRequest',
    'GenericScheme',
    'GenesisProtocol',
    'GlobalConstraintRegistrar',
    'Join',
    'Locking4Reputation',
    'LockingEth4Reputation',
    'LockingToken4Reputation',
    'NectarRepAllocation',
    'PolkaCurve',
    'Redeemer',
    'RepAllocation',
    'Reputation',
    'ReputationAdmin',
    'ReputationFromToken',
    'ReputationTokenTrade',
    'SchemeFactory',
    'SchemeMock',
    'SchemeRegistrar',
    'SignalScheme',
    'TokenTrade',
    'UpgradeScheme',
    'Vault',
    'VoteInOrganizationScheme',
    'VotingMachineCallbacks',
    'Wallet'
  ]

  for (let file of files) {
    const { contractName } = require(`${file}`)

    if (arcPackageContracts.indexOf(contractName) === -1) {
      continue
    }

    let Contract

    if (contractName === 'GenesisProtocol') {
      Contract = await deploy(
        utils.importAbi(`./${contractsDir}/${arcVersion}/GenesisProtocol.json`),
        ['DAOToken'],
        GENToken
      )
    } else {
      Contract = await deploy(require(`${file}`))
    }

    tx = (await sendTx(
      implementationDirectory.methods.setImplementation(contractName, Contract),
      `Registering ${contractName}...`
    )).receipt
    await logTx(tx, `Finished Registering Implementation Contract: ${contractName}`)
  }

  const TESTNET_ACCOUNT = '0x73Db6408abbea97C5DB8A2234C4027C315094936'
  const DAOSTACK_ACCOUNT = '0x85e7fa550b534656d04d143b9a23a11e05077da3'
  const DAOREGISTRY_ADMIN_ACCOUNT = '0xe5b49414b2e130c28a4E67ab6Fe34AcdC0d4beDF'
  let adminAddress, daoRegistryAdminAddress
  switch (network) {
    case 'kovan':
    case 'rinkeby':
    case 'xdai':
    case 'sokol':
      // TODO: Here add the address private key to the web3 wallet.
      adminAddress = web3.eth.accounts.wallet[0].address
      daoRegistryAdminAddress = TESTNET_ACCOUNT // TODO: USE A DIFFERENT ACOUNT
      break
    case 'mainnet':
      adminAddress = DAOSTACK_ACCOUNT
      daoRegistryAdminAddress = DAOREGISTRY_ADMIN_ACCOUNT // TODO: USE A DIFFERENT ACOUNT
      break
    case 'private':
      adminAddress = web3.eth.accounts.wallet[1].address
      daoRegistryAdminAddress = web3.eth.accounts.wallet[0].address
      break
  }

  addresses['DAORegistryInstance'] = shouldDeploy('DAORegistryInstance', utils.importAbi(`./${contractsDir}/${arcVersion}/AdminUpgradeabilityProxy.json`).deployedBytecode)
  if (!(await addresses['DAORegistryInstance'])) {
    let initData = await new web3.eth.Contract(utils.importAbi(`./${contractsDir}/${arcVersion}/DAORegistry.json`).abi)
      .methods.initialize(daoRegistryAdminAddress).encodeABI()
    let daoRegistryTx = app.methods.create(
      packageName,
      'DAORegistry',
      adminAddress,
      initData
    )
    let DAORegistry = await daoRegistryTx.call()

    tx = (await sendTx(daoRegistryTx, 'Deploying DAORegistry...')).receipt
    await logTx(tx, 'Finished Deploying DAORegistry')

    addresses['DAORegistryInstance'] = DAORegistry
  } else {
    let daoRegistry = new web3.eth.Contract(
      utils.importAbi(`./${contractsDir}/${arcVersion}/AdminUpgradeabilityProxy.json`).abi,
      addresses['DAORegistryInstance'],
      opts
    )
    tx = (await sendTx(
      daoRegistry.methods.upgradeTo(addresses['DAORegistry']),
      `Upgrading DAORegistry contract to version 0.1.${getArcVersionNumber(arcVersion)}...`,
      adminAddress)
    ).receipt
    await logTx(tx, `Finished upgrading DAORegistry to version 0.1.${getArcVersionNumber(arcVersion)}`)
  }

  addresses['DAOFactoryInstance'] = shouldDeploy('DAOFactoryInstance', utils.importAbi(`./${contractsDir}/${arcVersion}/AdminUpgradeabilityProxy.json`).deployedBytecode)
  if (!(await addresses['DAOFactoryInstance'])) {
    let initData = await new web3.eth.Contract(utils.importAbi(`./${contractsDir}/${arcVersion}/DAOFactory.json`).abi)
      .methods.initialize(App).encodeABI()

    let DAOFactory = await deploy(
      utils.importAbi(`./${contractsDir}/${arcVersion}/AdminUpgradeabilityProxy.json`),
      [],
      addresses['DAOFactory'], adminAddress, initData
    )

    addresses['DAOFactoryInstance'] = DAOFactory
  } else {
    let daoFactory = new web3.eth.Contract(
      utils.importAbi(`./${contractsDir}/${arcVersion}/AdminUpgradeabilityProxy.json`).abi,
      addresses['DAOFactoryInstance'],
      opts
    )
    tx = (await sendTx(
      daoFactory.methods.upgradeTo(addresses['DAOFactory']),
      `Upgrading DAOFactory contract to version 0.1.${getArcVersionNumber(arcVersion)}...`,
      adminAddress)
    ).receipt
    await logTx(tx, `Finished upgrading DAOFactory to version 0.1.${getArcVersionNumber(arcVersion)}`)
  }

  let migration = { 'package': previousMigration.package || {} }
  migration.package[arcVersion] = addresses
  return migration
}

module.exports = migrateBase
