async function migrateEthCCDAO ({ web3, spinner, confirm, opts, migrationParams, logTx, previousMigration: { base } }) {
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
    DaoCreator,
    SchemeRegistrar,
    ContributionReward,
    GenericScheme,
    GenesisProtocol,
    Wallet
  } = base

  const daoCreator = new web3.eth.Contract(
    require('@daostack/arc/build/contracts/DaoCreator.json').abi,
    DaoCreator,
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
  const [orgName, tokenName, tokenSymbol, founderAddresses, tokenDist, repDist, uController, cap] = [
    randomName,
    randomName + ' Token',
    randomName[0] + randomName.split(' ')[0] + 'T',
    migrationParams.founders.map(({ address }) => address),
    migrationParams.founders.map(({ tokens }) => web3.utils.toWei(tokens.toString())),
    migrationParams.founders.map(({ reputation }) => web3.utils.toWei(reputation.toString())),
    UController,
    '0'
  ]

  spinner.start('Creating a new organization...')
  const forgeOrg = daoCreator.methods.forgeOrg(
    orgName,
    tokenName,
    tokenSymbol,
    founderAddresses,
    tokenDist,
    repDist,
    uController,
    cap
  )

  const Avatar = await forgeOrg.call()
  tx = await forgeOrg.send()
  await logTx(tx, 'Created new organization.')

  await wallet.methods.transferOwnership(Avatar).send()

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
  tx = await daoCreator.methods.setSchemes(Avatar, schemes, params, permissions, 'metaData').send()
  await logTx(tx, 'DAO schemes set.')

  const avatar = new web3.eth.Contract(require('@daostack/arc/build/contracts/Avatar.json').abi, Avatar, opts)

  const DAOToken = await avatar.methods.nativeToken().call()
  const Reputation = await avatar.methods.nativeReputation().call()

  return {
    ethcc_dao: {
      name: orgName,
      Avatar,
      DAOToken,
      Reputation
    }
  }
}

module.exports = migrateEthCCDAO
