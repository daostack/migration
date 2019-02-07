async function migrateBase ({ web3, spinner, confirm, opts, logTx, previousMigration }) {
  if (!(await confirm('About to migrate base contracts. Continue?'))) {
    return
  }

  const addresses = {}
  async function deploy ({ contractName, abi, bytecode, deployedBytecode }, deps, ...args) {
    deps = deps || []
    const existing = previousMigration.base || {}
    const sameDeps = deps.reduce((acc, dep) => addresses[dep] === existing[dep] && acc, true)

    const entryName = (contractName === 'DAOToken') ? contractName = 'GEN' : contractName

    const code = existing[entryName] && (await web3.eth.getCode(existing[contractName]))
    const sameCode = existing[entryName] && deployedBytecode === code

    if (
      entryName === 'GEN' &&
      existing[entryName] &&
      code !== '0x' &&
      !(await confirm(`Found existing GEN (DAOToken) contract, Deploy new instance?`, false))
    ) {
      addresses[entryName] = existing[entryName]
      return existing[entryName]
    } else if (
      sameCode &&
      sameDeps &&
      !(await confirm(
        `Found existing '${entryName}' instance with same bytecode and ${
          !deps.length ? 'no ' : ''
        }dependencies on other contracts at '${existing[entryName]}'. Deploy new instance?`,
        false
      ))
    ) {
      addresses[entryName] = existing[entryName]
      return existing[entryName]
    }

    spinner.start(`Migrating ${contractName}...`)
    const contract = new web3.eth.Contract(abi, undefined, opts)
    const deployContract = contract.deploy({
      data: bytecode,
      arguments: args
    }).send()
    const tx = await new Promise(resolve => deployContract.on('receipt', resolve))
    const c = await deployContract
    await logTx(tx, `${c.options.address} => ${contractName}`)
    addresses[contractName] = c.options.address
    return c.options.address
  }

  const network = await web3.eth.net.getNetworkType()
  let GENToken = '0x543Ff227F64Aa17eA132Bf9886cAb5DB55DCAddf'

  if (network === 'private') {
    GENToken = await deploy(
      require('@daostack/arc/build/contracts/DAOToken.json'),
      [],
      'DAOstack',
      'GEN',
      web3.utils.toWei('100000000')
    )
  } else {
    addresses['GEN'] = GENToken
  }

  const ControllerCreator = await deploy(require('@daostack/arc/build/contracts/ControllerCreator.json'))

  await deploy(
    require('@daostack/arc/build/contracts/DaoCreator.json'),
    ['ControllerCreator'],
    ControllerCreator
  )
  await deploy(require('@daostack/arc/build/contracts/UController.json'))
  const GenesisProtocol = await deploy(
    require('@daostack/arc/build/contracts/GenesisProtocol.json'),
    ['DAOToken'],
    GENToken
  )
  await deploy(require('@daostack/arc/build/contracts/SchemeRegistrar.json'))
  await deploy(require('@daostack/arc/build/contracts/UpgradeScheme.json'))
  await deploy(
    require('@daostack/arc/build/contracts/GlobalConstraintRegistrar.json')
  )
  const ContributionReward = await deploy(require('@daostack/arc/build/contracts/ContributionReward.json'))
  await deploy(require('@daostack/arc/build/contracts/AbsoluteVote.json'))
  await deploy(require('@daostack/arc/build/contracts/QuorumVote.json'))
  await deploy(require('@daostack/arc/build/contracts/TokenCapGC.json'))
  await deploy(require('@daostack/arc/build/contracts/VestingScheme.json'))
  await deploy(require('@daostack/arc/build/contracts/VoteInOrganizationScheme.json'))
  await deploy(require('@daostack/arc/build/contracts/OrganizationRegister.json'))
  await deploy(
    require('@daostack/arc/build/contracts/Redeemer.json'),
    ['ContributionReward', 'GenesisProtocol'],
    ContributionReward,
    GenesisProtocol
  )

  await deploy(require('@daostack/arc/build/contracts/GenericScheme.json'))

  return {
    base: addresses
  }
}

module.exports = migrateBase
