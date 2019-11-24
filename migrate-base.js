const glob = require('glob')

async function migrateBase ({ arcVersion, web3, confirm, opts, logTx, previousMigration, getArcVersionNumber, sendTx }) {
  let tx
  if (!(await confirm('About to migrate arc package. Continue?'))) {
    return
  }

  const arcURL = `https://github.com/daostack/arc/releases/tag/${arcVersion}`

  const addresses = {}
  const network = await web3.eth.net.getNetworkType()

  async function deploy ({ contractName, abi, bytecode, deployedBytecode }, deps, ...args) {
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

    let { receipt, result } = await sendTx(new web3.eth.Contract(abi, undefined, opts).deploy({
      data: bytecode,
      arguments: args
    }), `Migrating ${contractName}...`)
    await logTx(receipt, `${result.options.address} => ${contractName}`)
    addresses[contractName] = result.options.address
    return result.options.address
  }

  // OpenZepplin App and Package setup
  let packageName = 'DAOstack'

  let Package = await deploy(require(`./contracts/${arcVersion}/Package.json`))
  let packageContract = new web3.eth.Contract(
    require(`./contracts/${arcVersion}/Package.json`).abi,
    Package,
    opts
  )

  if (await packageContract.methods.hasVersion([0, 0, getArcVersionNumber(arcVersion)]).call()) {
    if (!(
      await confirm(
        `Package ${packageName} version 0.0.${getArcVersionNumber(arcVersion)} already exists. Would you like to deploy a new Package contract?`,
        false
      )
    )) {
      return
    }
    delete previousMigration.package
    Package = await deploy(require(`./contracts/${arcVersion}/Package.json`))
    packageContract = new web3.eth.Contract(
      require(`./contracts/${arcVersion}/Package.json`).abi,
      Package,
      opts
    )
  }

  const ImplementationDirectory = await deploy(require(`./contracts/${arcVersion}/ImplementationDirectory.json`))
  let implementationDirectory = new web3.eth.Contract(
    require(`./contracts/${arcVersion}/ImplementationDirectory.json`).abi,
    ImplementationDirectory,
    opts
  )

  tx = (await sendTx(
    packageContract.methods.addVersion(
      [0, 0, getArcVersionNumber(arcVersion)],
      ImplementationDirectory,
      web3.utils.hexToBytes(web3.utils.utf8ToHex(arcURL))
    ), `Adding version 0.0.${getArcVersionNumber(arcVersion)} to ${packageName} Package`)
  ).receipt
  await logTx(tx, `Added version 0.0.${getArcVersionNumber(arcVersion)} to ${packageName} Package`)
  let App = await deploy(require(`./contracts/${arcVersion}/App.json`))
  let app = new web3.eth.Contract(
    require(`./contracts/${arcVersion}/App.json`).abi,
    App,
    opts
  )

  tx = (await sendTx(
    app.methods.setPackage(packageName, Package, [0, 0, getArcVersionNumber(arcVersion)]),
    `Setting App package to version 0.0.${getArcVersionNumber(arcVersion)}`)).receipt
  await logTx(tx, `App package version has been set to 0.0.${getArcVersionNumber(arcVersion)}`)

  // Setup the GEN token contract
  let GENToken = '0x543Ff227F64Aa17eA132Bf9886cAb5DB55DCAddf'

  if (network === 'private') {
    GENToken = await deploy({ ...require(`./contracts/${arcVersion}/DAOToken.json`), contractName: 'GEN' })

    const GENTokenContract = new web3.eth.Contract(
      require(`./contracts/${arcVersion}/DAOToken.json`).abi,
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
    'AbsoluteVote',
    'AbsoluteVoteExecuteMock',
    'ActionMock',
    'Agreement',
    'AgreementMock',
    'ARCDebug',
    'ARCVotingMachineCallbacksMock',
    'Auction4Reputation',
    'Avatar',
    'ContinuousLocking4Reputation',
    'ContributionReward',
    'Controller',
    'ControllerCreator',
    'DAOFactory',
    'DAOToken',
    'DAOTracker',
    'ExternalLocking4Reputation',
    'ExternalTokenLockerMock',
    'FixedReputationAllocation',
    'Forwarder',
    'GenericScheme',
    'GenesisProtocol',
    'GenesisProtocolCallbacksMock',
    'GlobalConstraintMock',
    'GlobalConstraintRegistrar',
    'Locking4Reputation',
    'LockingEth4Reputation',
    'LockingToken4Reputation',
    'NectarRepAllocation',
    'PolkaCurve',
    'PriceOracleMock',
    'QuorumVote',
    'Redeemer',
    'RepAllocation',
    'Reputation',
    'ReputationFromToken',
    'SchemeMock',
    'SchemeRegistrar',
    'SignalScheme',
    'TokenCapGC',
    'UpgradeScheme',
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
        require(`./contracts/${arcVersion}/GenesisProtocol.json`),
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
  let adminAddress
  switch (network) {
    case 'kovan':
    case 'rinkeby':
      adminAddress = TESTNET_ACCOUNT
      break
    case 'mainnet':
      adminAddress = DAOSTACK_ACCOUNT
      break
    case 'private':
      adminAddress = web3.eth.accounts.wallet[1].address
      break
  }

  if (!previousMigration.package[arcVersion] || previousMigration.package[arcVersion]['DAOTrackerInstance'] === undefined) {
    let initData = await new web3.eth.Contract(require(`./contracts/${arcVersion}/DAOTracker.json`).abi)
      .methods.initialize(adminAddress).encodeABI()
    let daoTrackerTx = app.methods.create(
      packageName,
      'DAOTracker',
      adminAddress,
      initData
    )
    let DAOTracker = await daoTrackerTx.call()

    tx = (await sendTx(daoTrackerTx, 'Deploying DAOTracker...')).receipt
    await logTx(tx, 'Finished Deploying DAOTracker')

    addresses['DAOTrackerInstance'] = DAOTracker
  } else {
    let daoTracker = new web3.eth.Contract(
      require(`./contracts/${arcVersion}/AdminUpgradeabilityProxy.json`).abi,
      previousMigration.package[arcVersion]['DAOTrackerInstance'],
      opts
    )
    tx = (await sendTx(
      daoTracker.methods.upgradeTo(addresses['DAOTracker']),
      `Upgrading DAOTracker contract to version 0.0.${getArcVersionNumber(arcVersion)}...`,
      web3.eth.accounts.wallet[1].address)
    ).receipt
    await logTx(tx, `Finished upgrading DAOTracker to version 0.0.${getArcVersionNumber(arcVersion)}`)

    addresses['DAOTrackerInstance'] = previousMigration.package[arcVersion]['DAOTrackerInstance']
  }

  if (!previousMigration.package[arcVersion] || previousMigration.package[arcVersion]['DAOFactoryInstance'] === undefined) {
    let initData = await new web3.eth.Contract(require(`./contracts/${arcVersion}/DAOFactory.json`).abi)
      .methods.initialize(App, addresses['DAOTrackerInstance']).encodeABI()

    let daoFactoryTx = app.methods.create(
      packageName,
      'DAOFactory',
      adminAddress,
      initData
    )
    let DAOFactory = await daoFactoryTx.call()

    tx = (await sendTx(daoFactoryTx, 'Deploying DAOFactory...')).receipt
    await logTx(tx, 'Finished Deploying DAOFactory')

    addresses['DAOFactoryInstance'] = DAOFactory
  } else {
    let daoFactory = new web3.eth.Contract(
      require(`./contracts/${arcVersion}/AdminUpgradeabilityProxy.json`).abi,
      previousMigration.package[arcVersion]['DAOFactoryInstance'],
      opts
    )
    tx = (await sendTx(
      daoFactory.methods.upgradeTo(addresses['DAOFactory']),
      `Upgrading DAOFactory contract to version 0.0.${getArcVersionNumber(arcVersion)}...`,
      web3.eth.accounts.wallet[1].address)
    ).receipt
    await logTx(tx, `Finished upgrading DAOFactory to version 0.0.${getArcVersionNumber(arcVersion)}`)

    addresses['DAOFactoryInstance'] = previousMigration.package[arcVersion]['DAOFactoryInstance']
  }

  let migration = { 'package': previousMigration.package || {} }
  migration.package[arcVersion] = addresses
  return migration
}

module.exports = migrateBase
