const utils = require('./utils.js')
const migrateDAO = require('./migrate-dao.js')

async function assignGlobalVariables (arcVersion, web3, spinner, opts, logTx, sendTx, previousMigration) {
  this.arcVersion = arcVersion
  this.web3 = web3
  this.spinner = spinner
  this.opts = opts
  this.logTx = logTx
  this.sendTx = sendTx
  this.package = previousMigration.package[this.arcVersion]
}

async function migrateDemoTest (options) {
  const {
    arcVersion,
    web3,
    spinner,
    confirm,
    opts,
    logTx,
    sendTx,
    previousMigration
  } = options

  if (!(await confirm('About to migrate new Demo Test. Continue?'))) {
    return
  }

  assignGlobalVariables(arcVersion, web3, spinner, opts, logTx, sendTx, previousMigration)

  if (!this.package) {
    const msg = `Couldn't find existing package migration ('migration.json' > 'package').`
    this.spinner.fail(msg)
    throw new Error(msg)
  }

  const orgName = utils.generateRandomName()
  const migrationParams = {
    orgName,
    tokenName: orgName + ' Token',
    tokenSymbol: orgName[0] + orgName.split(' ')[1][0] + 'T',
    tokenCap: 0,
    metaData: 'metadata',
    VotingMachinesParams: [
      {
        boostedVotePeriodLimit: 600,
        daoBountyConst: 10,
        minimumDaoBounty: 100,
        queuedVotePeriodLimit: 1800,
        queuedVoteRequiredPercentage: 50,
        preBoostedVotePeriodLimit: 600,
        proposingRepReward: 5,
        quietEndingPeriod: 300,
        thresholdConst: 2000,
        voteOnBehalf: '0x0000000000000000000000000000000000000000',
        votersReputationLossRatio: 1,
        activationTime: 0
      }
    ],
    Schemes: [
      {
        name: 'ContributionReward',
        alias: 'ContributionRewardAlias',
        permissions: '0x00000000',
        params: [
          'GenesisProtocolAddress',
          { voteParams: 0 }
        ]
      },
      {
        name: 'GenericScheme',
        alias: 'GenericSchemeAlias',
        permissions: '0x00000010',
        params: [
          'GenesisProtocolAddress',
          { voteParams: 0 },
          { StandAloneContract: 0 }
        ]
      },
      {
        name: 'SchemeRegistrar',
        alias: 'SchemeRegistrarAlias',
        permissions: '0x0000001F',
        params: [
          'GenesisProtocolAddress',
          { voteParams: 0 },
          { voteParams: 0 }
        ]
      }
    ],
    StandAloneContracts: [
      {
        name: 'ActionMock',
        fromArc: true,
        noProxy: true
      }
    ],
    founders: options.migrationParams.founders
  }

  this.spinner.start('Migrating Demo Test...')

  let accounts = this.web3.eth.accounts.wallet

  const {
    DAORegistryInstance,
    GenesisProtocol,
    GEN
  } = this.package

  const GENToken = await new this.web3.eth.Contract(
    require(`./contracts/${this.arcVersion}/DAOToken.json`).abi,
    GEN,
    this.opts
  )

  for (let i = 0; i < accounts.length; i++) {
    await GENToken.methods.approve(
      GenesisProtocol,
      this.web3.utils.toWei('1000')
    ).send({ from: accounts[i].address })
  }

  const externalTokenAddress = await migrateExternalToken()

  const migration = await migrateDAO({
    ...options,
    restart: true,
    migrationParams
  })

  const {
    Avatar,
    DAOToken,
    Reputation,
    Controller,
    Schemes,
    StandAloneContracts
  } = migration.dao[arcVersion]

  const ActionMock = StandAloneContracts[0].address
  const ContributionReward = Schemes[0].address
  const GenericScheme = Schemes[1].address

  const {
    gsProposalId,
    queuedProposalId,
    preBoostedProposalId,
    boostedProposalId,
    executedProposalId
  } = await submitDemoProposals(accounts, web3, Avatar, ContributionReward, GenericScheme, externalTokenAddress, ActionMock)

  let network = await this.web3.eth.net.getNetworkType()
  if (network === 'private') {
    if (await web3.eth.net.getId() === 100) {
      network = 'xdai'
    } else if (await web3.eth.net.getId() === 77) {
      network = 'sokol'
    }
  }

  if (network === 'private') {
    const daoRegistry = new this.web3.eth.Contract(
      require(`./contracts/${this.arcVersion}/DAORegistry.json`).abi,
      DAORegistryInstance,
      this.opts
    )
    this.spinner.start('Registering DAO in DAORegistry')
    let tx = await daoRegistry.methods.propose(Avatar).send()
    tx = await daoRegistry.methods.register(Avatar, orgName).send()
    await this.logTx(tx, 'Finished Registering DAO in DAORegistry')
  }

  const DemoDAOToken = await new this.web3.eth.Contract(
    require(`./contracts/${this.arcVersion}/DAOToken.json`).abi,
    undefined,
    this.opts
  ).deploy({
    data: require(`./contracts/${this.arcVersion}/DAOToken.json`).bytecode,
    arguments: ['DemoToken', 'DTN', 0]
  }).send()

  const DemoReputation = await new this.web3.eth.Contract(
    require(`./contracts/${this.arcVersion}/Reputation.json`).abi,
    undefined,
    this.opts
  ).deploy({
    data: require(`./contracts/${this.arcVersion}/Reputation.json`).bytecode
  }).send()

  const DemoAvatar = await new this.web3.eth.Contract(
    require(`./contracts/${this.arcVersion}/Avatar.json`).abi,
    undefined,
    this.opts
  ).deploy({
    data: require(`./contracts/${this.arcVersion}/Avatar.json`).bytecode,
    arguments: ['DemoAvatar', DemoDAOToken.options.address, DemoReputation.options.address]
  }).send()

  let result = { 'test': previousMigration.test || {} }
  result.test[this.arcVersion] = {
    name: orgName,
    Controller,
    Avatar,
    DAOToken,
    Reputation,
    ActionMock,
    gsProposalId,
    queuedProposalId,
    preBoostedProposalId,
    boostedProposalId,
    executedProposalId,
    organs: {
      DemoAvatar: DemoAvatar.options.address,
      DemoDAOToken: DemoDAOToken.options.address,
      DemoReputation: DemoReputation.options.address
    }
  }
  return result
}

async function migrateExternalToken () {
  this.spinner.start('Migrating External Token...')

  const externalToken = await new this.web3.eth.Contract(
    require(`./contracts/${this.arcVersion}/DAOToken.json`).abi,
    undefined,
    this.opts
  ).deploy({
    data: require(`./contracts/${this.arcVersion}/DAOToken.json`).bytecode,
    arguments: ['External', 'EXT', 0]
  }).send()

  return externalToken.options.address
}

async function submitDemoProposals (accounts, web3, avatarAddress, crAddress, gsAddress, externalTokenAddress, actionMockAddress) {
  const [PASS, FAIL] = [1, 2]
  const actionMock = await new this.web3.eth.Contract(
    require(`./contracts/${this.arcVersion}/ActionMock.json`).abi,
    actionMockAddress,
    this.opts
  )
  let callData = await actionMock.methods.test2(avatarAddress).encodeABI()
  let gsProposalId = await submitGSProposal({
    gsAddress,
    callData,
    descHash: '0x000000000000000000000000000000000000000000000000000000000000abcd'
  })
  // QUEUED PROPOSAL //
  let queuedProposalId = await submitProposal({
    crAddress,
    descHash: '0x000000000000000000000000000000000000000000000000000000000000abcd',
    rep: web3.utils.toWei('10'),
    tokens: web3.utils.toWei('10'),
    eth: web3.utils.toWei('10'),
    external: web3.utils.toWei('10'),
    periodLength: 0,
    periods: 1,
    beneficiary: accounts[1].address,
    externalTokenAddress: externalTokenAddress
  })

  await voteOnProposal({
    proposalId: queuedProposalId,
    outcome: FAIL,
    voter: accounts[2].address
  })

  await voteOnProposal({
    proposalId: queuedProposalId,
    outcome: PASS,
    voter: accounts[1].address
  })

  // PRE BOOSTED PROPOSAL //
  let preBoostedProposalId = await submitProposal({
    crAddress,
    descHash: '0x000000000000000000000000000000000000000000000000000000000000efgh',
    rep: web3.utils.toWei('10'),
    tokens: web3.utils.toWei('10'),
    eth: web3.utils.toWei('10'),
    external: web3.utils.toWei('10'),
    periodLength: 0,
    periods: 1,
    beneficiary: accounts[1].address,
    externalTokenAddress: externalTokenAddress
  })

  await stakeOnProposal({
    proposalId: preBoostedProposalId,
    outcome: PASS,
    staker: accounts[1].address,
    amount: this.web3.utils.toWei('1000')
  })

  // BOOSTED PROPOSAL //
  let boostedProposalId = await submitProposal({
    crAddress,
    descHash: '0x000000000000000000000000000000000000000000000000000000000000ijkl',
    rep: web3.utils.toWei('10'),
    tokens: web3.utils.toWei('10'),
    eth: web3.utils.toWei('10'),
    external: web3.utils.toWei('10'),
    periodLength: 0,
    periods: 1,
    beneficiary: accounts[1].address,
    externalTokenAddress: externalTokenAddress
  })

  await stakeOnProposal({
    proposalId: boostedProposalId,
    outcome: PASS,
    staker: accounts[2].address,
    amount: this.web3.utils.toWei('1000')
  })

  await voteOnProposal({
    proposalId: boostedProposalId,
    outcome: PASS,
    voter: accounts[1].address
  })

  await increaseTime(259300, web3)

  await voteOnProposal({
    proposalId: boostedProposalId,
    outcome: PASS,
    voter: accounts[0].address
  })

  // EXECUTED PROPOSAL //
  let executedProposalId = await submitProposal({
    crAddress,
    descHash: '0x000000000000000000000000000000000000000000000000000000000000ijkl',
    rep: web3.utils.toWei('10'),
    tokens: web3.utils.toWei('10'),
    eth: web3.utils.toWei('10'),
    external: web3.utils.toWei('10'),
    periodLength: 0,
    periods: 1,
    beneficiary: accounts[1].address,
    externalTokenAddress: externalTokenAddress
  })

  await voteOnProposal({
    proposalId: executedProposalId,
    outcome: PASS,
    voter: accounts[0].address
  })

  await voteOnProposal({
    proposalId: executedProposalId,
    outcome: PASS,
    voter: accounts[1].address
  })

  await voteOnProposal({
    proposalId: executedProposalId,
    outcome: PASS,
    voter: accounts[2].address
  })

  await voteOnProposal({
    proposalId: executedProposalId,
    outcome: PASS,
    voter: accounts[3].address
  })

  return {
    gsProposalId,
    queuedProposalId,
    preBoostedProposalId,
    boostedProposalId,
    executedProposalId
  }
}

async function submitGSProposal ({
  gsAddress,
  callData,
  descHash
}) {
  this.spinner.start('Submitting a new Proposal...')

  let tx

  const genericScheme = new this.web3.eth.Contract(
    require(`./contracts/${this.arcVersion}/GenericScheme.json`).abi,
    gsAddress,
    this.opts
  )

  const prop = genericScheme.methods.proposeCall(
    callData,
    0,
    descHash
  )

  const proposalId = await prop.call()
  tx = await prop.send()
  await this.logTx(tx, 'Submit new Proposal.')

  return proposalId
}

async function submitProposal ({
  crAddress,
  descHash,
  rep,
  tokens,
  eth,
  external,
  periodLength,
  periods,
  beneficiary,
  externalTokenAddress
}) {
  this.spinner.start('Submitting a new Proposal...')

  let tx

  const contributionReward = new this.web3.eth.Contract(
    require(`./contracts/${this.arcVersion}/ContributionReward.json`).abi,
    crAddress,
    this.opts
  )

  const prop = contributionReward.methods.proposeContributionReward(
    descHash,
    rep,
    [tokens, eth, external, periodLength, periods],
    externalTokenAddress,
    beneficiary
  )

  const proposalId = await prop.call()
  tx = await prop.send()
  await this.logTx(tx, 'Submit new Proposal.')

  return proposalId
}

async function voteOnProposal ({ proposalId, outcome, voter }) {
  this.spinner.start('Voting on proposal...')

  const {
    GenesisProtocol
  } = this.package

  let tx

  const genesisProtocol = new this.web3.eth.Contract(
    require(`./contracts/${this.arcVersion}/GenesisProtocol.json`).abi,
    GenesisProtocol,
    this.opts
  )

  tx = await genesisProtocol.methods
    .vote(proposalId, outcome, 0, voter)
    .send({ from: voter })

  await this.logTx(tx, 'Voted on Proposal.')
}

async function stakeOnProposal ({ proposalId, outcome, staker, amount }) {
  this.spinner.start('Staking on proposal...')

  const {
    GenesisProtocol
  } = this.package

  let tx

  const genesisProtocol = new this.web3.eth.Contract(
    require(`./contracts/${this.arcVersion}/GenesisProtocol.json`).abi,
    GenesisProtocol,
    this.opts
  )

  tx = await genesisProtocol.methods
    .stake(proposalId, outcome, amount)
    .send({ from: staker })

  await this.logTx(tx, 'Staked on Proposal.')
}

async function increaseTime (duration, web3) {
  const id = await Date.now()
  web3.providers.HttpProvider.prototype.sendAsync = web3.providers.HttpProvider.prototype.send

  return new Promise((resolve, reject) => {
    web3.currentProvider.sendAsync({
      jsonrpc: '2.0',
      method: 'evm_increaseTime',
      params: [duration],
      id
    }, (err1) => {
      if (err1) { return reject(err1) }

      web3.currentProvider.sendAsync({
        jsonrpc: '2.0',
        method: 'evm_mine',
        id: id + 1
      }, (err2, res) => {
        return err2 ? reject(err2) : resolve(res)
      })
    })
  })
}

module.exports = migrateDemoTest
