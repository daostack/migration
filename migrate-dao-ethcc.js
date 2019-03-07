async function migrateEthCCDAO ({ web3, spinner, confirm, opts, migrationParams, logTx, previousMigration: { base } }) {
  opts.gas = 8000000
  migrationParams = require('./migration-params-ethparis.json').default
  if (!(await confirm('About to migrate new DAO. Continue?'))) {
    return
  }

  if (!base) {
    const msg = `Couldn't find existing base migration ('migration.json' > 'base').`
    spinner.fail(msg)
    throw new Error(msg)
  }

  spinner.start('Migrating DAO...')
  const SuperUser = "0x73Db6408abbea97C5DB8A2234C4027C315094936"
  let tx

  const {
    UController,
    SchemeRegistrar,
    ContributionReward,
    GenericScheme,
    GenesisProtocol,
    Wallet
  } = base

  const uController = new web3.eth.Contract(
    require('@daostack/arc/build/contracts/UController.json').abi,
    UController,
    opts
  )

  const schemeRegistrar = new web3.eth.Contract(
    require('@daostack/arc/build/contracts/SchemeRegistrar.json').abi,
    SchemeRegistrar,
    opts
  )

  const contributionReward = new web3.eth.Contract(
    require('@daostack/arc/build/contracts/ContributionReward.json').abi,
    ContributionReward,
    opts
  )

  const genericScheme = new web3.eth.Contract(
    require('@daostack/arc/build/contracts/GenericScheme.json').abi,
    GenericScheme,
    opts
  )

  const wallet = new web3.eth.Contract(
    require('@daostack/arc/build/contracts/Wallet.json').abi,
    Wallet,
    opts
  )

  const genesisProtocol = new web3.eth.Contract(
    require('@daostack/arc/build/contracts/GenesisProtocol.json').abi,
    GenesisProtocol,
    opts
  )

  const randomName = 'ETHParisHackathon'
  const [orgName, tokenName, tokenSymbol, founderAddresses, tokenDist, repDist, cap] = [
    randomName,
    randomName + ' Token',
    'EPT',
    migrationParams.founders.map(({ address }) => address),
    migrationParams.founders.map(({ tokens }) => web3.utils.toWei(tokens.toString())),
    migrationParams.founders.map(({ reputation }) => web3.utils.toWei(reputation.toString())),
    '0'
  ]

  spinner.start('Creating a new organization...')

  const ETHCCDAOToken = (await new web3.eth.Contract(
    require('@daostack/arc/build/contracts/DAOToken.json').abi,
    undefined,
    opts
  ).deploy({
    data: require('@daostack/arc/build/contracts/DAOToken.json').bytecode,
    arguments: [tokenName, tokenSymbol, 0]
  }).send()).options.address

  const DAOReputation = (await new web3.eth.Contract(
    require('@daostack/arc/build/contracts/Reputation.json').abi,
    undefined,
    opts
  ).deploy({
    data: require('@daostack/arc/build/contracts/Reputation.json').bytecode
  }).send()).options.address

  const Avatar = (await new web3.eth.Contract(
    require('@daostack/arc/build/contracts/Avatar.json').abi,
    undefined,
    opts
  ).deploy({
    data: require('@daostack/arc/build/contracts/Avatar.json').bytecode,
    arguments: [randomName, ETHCCDAOToken, DAOReputation]
  }).send()).options.address

  console.log(Avatar)
  const reputation = await new web3.eth.Contract(
    require('@daostack/arc/build/contracts/Reputation.json').abi,
    DAOReputation,
    opts
  )

  const daoToken = await new web3.eth.Contract(
    require('@daostack/arc/build/contracts/DAOToken.json').abi,
    ETHCCDAOToken,
    opts
  )

  const avatar = await new web3.eth.Contract(
    require('@daostack/arc/build/contracts/Avatar.json').abi,
    Avatar,
    opts
  )

  console.log(avatar.options.address)

  await avatar.methods.transferOwnership(UController).send()
  await wallet.methods.transferOwnership(Avatar).send()

  await uController.methods.newOrganization(Avatar).send()
  await reputation.methods.transferOwnership(UController).send()
  await daoToken.methods.transferOwnership(UController).send()
  

  spinner.start('Setting GenesisProtocol parameters...')
  const genesisProtocolSetParams = genesisProtocol.methods.setParameters(
    [
      migrationParams.GenesisProtocol.queuedVoteRequiredPercentage,
      migrationParams.GenesisProtocol.queuedVotePeriodLimit,
      migrationParams.GenesisProtocol.boostedVotePeriodLimit,
      migrationParams.GenesisProtocol.preBoostedVotePeriodLimit,
      migrationParams.GenesisProtocol.thresholdConst,
      migrationParams.GenesisProtocol.quietEndingPeriod,
      web3.utils.toWei(migrationParams.GenesisProtocol.proposingRepRewardGwei.toString(), 'gwei'),
      migrationParams.GenesisProtocol.votersReputationLossRatio,
      web3.utils.toWei(migrationParams.GenesisProtocol.minimumDaoBountyGWei.toString(), 'gwei'),
      migrationParams.GenesisProtocol.daoBountyConst,
      migrationParams.GenesisProtocol.activationTime
    ],
    migrationParams.GenesisProtocol.voteOnBehalf
  )
  const genesisProtocolParams = await genesisProtocolSetParams.call()
  tx = await genesisProtocolSetParams.send()
  await logTx(tx, 'GenesisProtocol parameters set.')

  spinner.start('Setting SchemeRegistrar parameters...')
  const schemeRegistrarSetParams = schemeRegistrar.methods.setParameters(
    genesisProtocolParams,
    genesisProtocolParams,
    GenesisProtocol
  )
  const schemeRegistrarParams = await schemeRegistrarSetParams.call()
  tx = await schemeRegistrarSetParams.send()
  await logTx(tx, 'SchemeRegistrar parameters set.')

  spinner.start("Setting 'ContributionReward' parameters...")
  const contributionRewardSetParams = contributionReward.methods.setParameters(
    web3.utils.toWei(migrationParams.ContributionReward.orgNativeTokenFeeGWei.toString(), 'gwei'),
    genesisProtocolParams,
    GenesisProtocol
  )
  const contributionRewardParams = await contributionRewardSetParams.call()
  tx = await contributionRewardSetParams.send()
  await logTx(tx, 'ContributionReward parameters set.')

  spinner.start("Setting 'GenericScheme' parameters...")
  const genericSchemeSetParams = genericScheme.methods.setParameters(
    genesisProtocolParams,
    GenesisProtocol,
    Wallet
  )
  const genericSchemeParams = await genericSchemeSetParams.call()
  tx = await genericSchemeSetParams.send()
  await logTx(tx, 'GenericScheme parameters set.')

  const schemes = [SchemeRegistrar, ContributionReward, GenericScheme, SuperUser]
  const params = [
    schemeRegistrarParams,
    contributionRewardParams,
    genericSchemeParams,
    "0x0000000000000000000000000000000000000000000000000000000000000000"
  ]
  const permissions = [
    '0x0000001F' /* all permissions */,
    '0x00000000' /* no permissions */,
    '0x00000010' /* generic action */,
    '0x0000001F' /* all permissions */,
  ]

  spinner.start('Setting DAO schemes...')
  tx = await uController.methods.registerScheme(schemes[0], params[0], permissions[0], Avatar).send()
  tx = await uController.methods.registerScheme(schemes[1], params[1], permissions[1], Avatar).send()
  tx = await uController.methods.registerScheme(schemes[2], params[2], permissions[2], Avatar).send()
  tx = await uController.methods.registerScheme(schemes[3], params[3], permissions[3], Avatar).send()

  console.log(web3.eth.defaultAccount)
  tx = await uController.methods.unregisterScheme(web3.eth.defaultAccount, Avatar).send()

  await logTx(tx, 'DAO schemes set.')

  const DAOToken = await avatar.methods.nativeToken().call()
  const Reputation = await avatar.methods.nativeReputation().call()

  return {
    ethcc_dao: {
      name: orgName,
      Avatar: Avatar,
      DAOToken,
      Reputation
    }
  }
}

module.exports = migrateEthCCDAO
