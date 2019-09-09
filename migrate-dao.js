const utils = require('./utils.js')
async function migrateDAO ({ web3, spinner, confirm, opts, migrationParams, logTx, previousMigration, customabislocation }) {
  let base = previousMigration.base
  if (!(await confirm('About to migrate new DAO. Continue?'))) {
    return
  }

  let arcVersion = require('./package.json').dependencies['@daostack/arc']

  if (!base[arcVersion]) {
    const msg = `Couldn't find existing base migration ('migration.json' > 'base').`
    spinner.fail(msg)
    throw new Error(msg)
  }

  spinner.start('Migrating DAO...')
  let contributionRewardParams, genericSchemeParams, schemeRegistrarParams, globalConstraintRegistrarParams, upgradeSchemeParams
  let tx
  let nonce = await web3.eth.getTransactionCount(web3.eth.defaultAccount) - 1

  const {
    UController,
    DaoCreator,
    DAORegistry,
    SchemeRegistrar,
    ContributionReward,
    UGenericScheme,
    GenesisProtocol,
    GlobalConstraintRegistrar,
    UpgradeScheme
  } = base[arcVersion]

  const daoCreator = new web3.eth.Contract(
    require('@daostack/arc/build/contracts/DaoCreator.json').abi,
    DaoCreator,
    opts
  )

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
    require('@daostack/arc/build/contracts/UGenericScheme.json').abi,
    UGenericScheme,
    opts
  )

  const globalConstraintRegistrar = new web3.eth.Contract(
    require('@daostack/arc/build/contracts/GlobalConstraintRegistrar.json').abi,
    GlobalConstraintRegistrar,
    opts
  )

  const upgradeScheme = new web3.eth.Contract(
    require('@daostack/arc/build/contracts/UpgradeScheme.json').abi,
    UpgradeScheme,
    opts
  )

  const genesisProtocol = new web3.eth.Contract(
    require('@daostack/arc/build/contracts/GenesisProtocol.json').abi,
    GenesisProtocol,
    opts
  )

  const randomName = utils.generateRnadomName()

  const [orgName, tokenName, tokenSymbol, founders] = [
    migrationParams.orgName !== undefined ? migrationParams.orgName : randomName,
    migrationParams.tokenName !== undefined ? migrationParams.tokenName : randomName + ' Token',
    migrationParams.tokenSymbol !== undefined ? migrationParams.tokenSymbol : randomName[0] + randomName.split(' ')[1][0] + 'T',
    migrationParams.founders
  ]

  let avatar
  let daoToken
  let reputation
  let Controller
  let controller
  let Schemes = { }

  if (migrationParams.useDaoCreator === true) {
    spinner.start('Creating a new organization...')

    const [founderAddresses, tokenDist, repDist] = [
      founders.map(({ address }) => address),
      founders.map(({ tokens }) => web3.utils.toWei(tokens !== undefined ? tokens.toString() : '0')),
      founders.map(({ reputation }) => web3.utils.toWei(reputation !== undefined ? reputation.toString() : '0'))
    ]

    const initFoundersBatchSize = 20
    const foundersBatchSize = 100
    let foundersInitCount = founderAddresses.length < initFoundersBatchSize ? founderAddresses.length : initFoundersBatchSize
    const forgeOrg = daoCreator.methods.forgeOrg(
      orgName,
      tokenName,
      tokenSymbol,
      founderAddresses.slice(0, foundersInitCount),
      tokenDist.slice(0, foundersInitCount),
      repDist.slice(0, foundersInitCount),
      migrationParams.useUController === true ? UController : '0x0000000000000000000000000000000000000000',
      '0'
    )

    tx = await forgeOrg.send({ nonce: ++nonce })

    const Avatar = tx.events.NewOrg.returnValues._avatar

    await logTx(tx, 'Created new organization.')

    let foundersToAddCount = founderAddresses.length - initFoundersBatchSize
    let i = 0
    while (foundersToAddCount > 0) {
      spinner.start('Adding founders...')
      let currentBatchCount = foundersToAddCount < foundersBatchSize ? foundersToAddCount : foundersBatchSize
      tx = await daoCreator.methods.addFounders(
        Avatar,
        founderAddresses.slice(i * foundersBatchSize + initFoundersBatchSize, i * foundersBatchSize + currentBatchCount + initFoundersBatchSize),
        tokenDist.slice(i * foundersBatchSize + initFoundersBatchSize, i * foundersBatchSize + currentBatchCount + initFoundersBatchSize),
        repDist.slice(i * foundersBatchSize + initFoundersBatchSize, i * foundersBatchSize + currentBatchCount + initFoundersBatchSize)
      ).send({ nonce: ++nonce })
      await logTx(tx, 'Finished adding founders.')
      foundersToAddCount -= foundersBatchSize
      i++
    }

    avatar = new web3.eth.Contract(
      require('@daostack/arc/build/contracts/Avatar.json').abi,
      Avatar,
      opts
    )

    daoToken = new web3.eth.Contract(
      require('@daostack/arc/build/contracts/DAOToken.json').abi,
      await avatar.methods.nativeToken().call(),
      opts
    )

    reputation = new web3.eth.Contract(
      require('@daostack/arc/build/contracts/Reputation.json').abi,
      await avatar.methods.nativeReputation().call(),
      opts
    )
    if (migrationParams.useUController) {
      Controller = UController
      controller = uController
    } else {
      spinner.start('Deploying Controller')
      controller = new web3.eth.Contract(
        require('@daostack/arc/build/contracts/Controller.json').abi,
        await avatar.methods.owner().call(),
        opts
      )
      Controller = controller.options.address
    }
  } else {
    spinner.start('Deploying DAO Token')
    daoToken = new web3.eth.Contract(
      require('@daostack/arc/build/contracts/DAOToken.json').abi,
      undefined,
      opts
    ).deploy({
      data: require('@daostack/arc/build/contracts/DAOToken.json').bytecode,
      arguments: [tokenName, tokenSymbol, 0]
    }).send({ nonce: ++nonce })

    tx = await new Promise(resolve => daoToken.on('receipt', resolve))
    let c = await daoToken
    await logTx(tx, `${c.options.address} => DAOToken`)
    daoToken = new web3.eth.Contract(
      require('@daostack/arc/build/contracts/DAOToken.json').abi,
      c.options.address,
      opts
    )

    spinner.start('Deploying Reputation')
    reputation = new web3.eth.Contract(
      require('@daostack/arc/build/contracts/Reputation.json').abi,
      undefined,
      opts
    ).deploy({
      data: require('@daostack/arc/build/contracts/Reputation.json').bytecode
    }).send({ nonce: ++nonce })

    tx = await new Promise(resolve => reputation.on('receipt', resolve))
    c = await reputation
    await logTx(tx, `${c.options.address} => Reputation`)
    reputation = new web3.eth.Contract(
      require('@daostack/arc/build/contracts/Reputation.json').abi,
      c.options.address,
      opts
    )

    spinner.start('Deploying Avatar.')
    avatar = new web3.eth.Contract(
      require('@daostack/arc/build/contracts/Avatar.json').abi,
      undefined,
      opts
    ).deploy({
      data: require('@daostack/arc/build/contracts/Avatar.json').bytecode,
      arguments: [orgName, daoToken.options.address, reputation.options.address]
    }).send({ nonce: ++nonce })

    tx = await new Promise(resolve => avatar.on('receipt', resolve))
    c = await avatar
    await logTx(tx, `${c.options.address} => Avatar`)
    avatar = new web3.eth.Contract(
      require('@daostack/arc/build/contracts/Avatar.json').abi,
      c.options.address,
      opts
    )

    spinner.start('Minting founders tokens and reputation')
    for (let i in founders) {
      let founder = founders[i]

      if (founder.reputation > 0) {
        tx = await reputation.methods.mint(founder.address, web3.utils.toWei(`${founder.reputation}`)).send({ nonce: ++nonce })
        await logTx(tx, `Minted ${founder.reputation} reputation to ${founder.address}`)
      }
      if (founder.tokens > 0) {
        tx = await daoToken.methods.mint(founder.address, web3.utils.toWei(`${founder.tokens}`)).send({ nonce: ++nonce })
        await logTx(tx, `Minted ${founder.tokens} tokens to ${founder.address}`)
      }
    }

    if (migrationParams.useUController) {
      Controller = UController
      controller = uController
    } else {
      spinner.start('Deploying Controller')
      controller = (await new web3.eth.Contract(
        require('@daostack/arc/build/contracts/Controller.json').abi,
        undefined,
        opts
      ).deploy({
        data: require('@daostack/arc/build/contracts/Controller.json').bytecode,
        arguments: [avatar.options.address]
      }).send({ nonce: ++nonce }))
      Controller = controller.options.address
    }

    spinner.start('Transfer Avatar to Controller ownership')
    tx = await avatar.methods.transferOwnership(Controller).send({ nonce: ++nonce })
    await logTx(tx, 'Finished transferring Avatar to Controller ownership')

    spinner.start('Transfer Reputation to Controller ownership')
    tx = await reputation.methods.transferOwnership(Controller).send({ nonce: ++nonce })
    await logTx(tx, 'Finished transferring Reputation to Controller ownership')

    spinner.start('Transfer DAOToken to Controller ownership')
    tx = await daoToken.methods.transferOwnership(Controller).send({ nonce: ++nonce })
    await logTx(tx, 'Finished transferring DAOToken to Controller ownership')

    if (migrationParams.useUController) {
      spinner.start('Register Avatar to UController')
      tx = await controller.methods.newOrganization(avatar.options.address).send({ nonce: ++nonce })
      await logTx(tx, 'Finished registerring Avatar')
    }
  }

  const network = await web3.eth.net.getNetworkType()

  if (network === 'private') {
    const daoRegistry = new web3.eth.Contract(
      require('@daostack/arc-hive/build/contracts/DAORegistry.json').abi,
      DAORegistry,
      opts
    )
    spinner.start('Registering DAO in DAORegistry')
    let DAOname = await avatar.methods.orgName().call()
    tx = await daoRegistry.methods.propose(avatar.options.address).send({ nonce: ++nonce })
    tx = await daoRegistry.methods.register(avatar.options.address, DAOname).send({ nonce: ++nonce })
    await logTx(tx, 'Finished Registering DAO in DAORegistry')
  }

  let schemeNames = []
  let schemes = []
  let params = []
  let permissions = []

  spinner.start('Setting GenesisProtocol parameters...')

  let votingMachinesParams = []

  for (let i in migrationParams.VotingMachinesParams) {
    if (migrationParams.VotingMachinesParams[i].votingParamsHash !== undefined) {
      votingMachinesParams.push(migrationParams.VotingMachinesParams[i].votingParamsHash)
      continue
    }
    const genesisProtocolSetParams = genesisProtocol.methods.setParameters(
      [
        migrationParams.VotingMachinesParams[i].queuedVoteRequiredPercentage,
        migrationParams.VotingMachinesParams[i].queuedVotePeriodLimit,
        migrationParams.VotingMachinesParams[i].boostedVotePeriodLimit,
        migrationParams.VotingMachinesParams[i].preBoostedVotePeriodLimit,
        migrationParams.VotingMachinesParams[i].thresholdConst,
        migrationParams.VotingMachinesParams[i].quietEndingPeriod,
        web3.utils.toWei(migrationParams.VotingMachinesParams[i].proposingRepReward.toString()),
        migrationParams.VotingMachinesParams[i].votersReputationLossRatio,
        web3.utils.toWei(migrationParams.VotingMachinesParams[i].minimumDaoBounty.toString()),
        migrationParams.VotingMachinesParams[i].daoBountyConst,
        migrationParams.VotingMachinesParams[i].activationTime
      ],
      migrationParams.VotingMachinesParams[i].voteOnBehalf
    )

    votingMachinesParams.push(await genesisProtocolSetParams.call())
    tx = await genesisProtocolSetParams.send({ nonce: ++nonce })
    await logTx(tx, 'GenesisProtocol parameters set.')
  }

  if (migrationParams.schemes.SchemeRegistrar) {
    for (let i in migrationParams.SchemeRegistrar) {
      spinner.start('Setting Scheme Registrar parameters...')
      const schemeRegistrarSetParams = schemeRegistrar.methods.setParameters(
        migrationParams.SchemeRegistrar[i].voteRegisterParams === undefined ? votingMachinesParams[0] : votingMachinesParams[migrationParams.SchemeRegistrar[i].voteRegisterParams],
        migrationParams.SchemeRegistrar[i].voteRemoveParams === undefined ? votingMachinesParams[0] : votingMachinesParams[migrationParams.SchemeRegistrar[i].voteRemoveParams],
        migrationParams.SchemeRegistrar[i].votingMachine === undefined ? GenesisProtocol : migrationParams.SchemeRegistrar[i].votingMachine
      )
      schemeRegistrarParams = await schemeRegistrarSetParams.call()
      tx = await schemeRegistrarSetParams.send({ nonce: ++nonce })
      await logTx(tx, 'Scheme Registrar parameters set.')
      schemeNames.push('Scheme Registrar')
      schemes.push(SchemeRegistrar)
      params.push(schemeRegistrarParams)
      permissions.push('0x0000001F')
    }
  }

  if (migrationParams.schemes.ContributionReward) {
    for (let i in migrationParams.ContributionReward) {
      spinner.start('Setting Contribution Reward parameters...')
      const contributionRewardSetParams = contributionReward.methods.setParameters(
        migrationParams.ContributionReward[i].voteParams === undefined ? votingMachinesParams[0] : votingMachinesParams[migrationParams.ContributionReward[i].voteParams],
        migrationParams.ContributionReward[i].votingMachine === undefined ? GenesisProtocol : migrationParams.ContributionReward[i].votingMachine
      )
      contributionRewardParams = await contributionRewardSetParams.call()
      tx = await contributionRewardSetParams.send({ nonce: ++nonce })
      await logTx(tx, 'Contribution Reward parameters set.')
      schemeNames.push('Contribution Reward')
      schemes.push(ContributionReward)
      params.push(contributionRewardParams)
      permissions.push('0x00000000')
    }
  }

  if (migrationParams.schemes.UGenericScheme) {
    for (let i in migrationParams.UGenericScheme) {
      spinner.start('Setting Generic Scheme parameters...')
      const genericSchemeSetParams = genericScheme.methods.setParameters(
        migrationParams.UGenericScheme[i].voteParams === undefined ? votingMachinesParams[0] : votingMachinesParams[migrationParams.UGenericScheme[i].voteParams],
        migrationParams.UGenericScheme[i].votingMachine === undefined ? GenesisProtocol : migrationParams.UGenericScheme[i].votingMachine,
        migrationParams.genericScheme[i].targetContract
      )
      genericSchemeParams = await genericSchemeSetParams.call()
      tx = await genericSchemeSetParams.send({ nonce: ++nonce })
      await logTx(tx, 'Generic Scheme parameters set.')
      schemeNames.push('Generic Scheme')
      schemes.push(UGenericScheme)
      params.push(genericSchemeParams)
      permissions.push('0x00000010')
    }
  }

  if (migrationParams.schemes.GlobalConstraintRegistrar) {
    for (let i in migrationParams.GlobalConstraintRegistrar) {
      spinner.start('Setting Global Constraint Registrar parameters...')
      const globalConstraintRegistrarSetParams = globalConstraintRegistrar.methods.setParameters(
        migrationParams.GlobalConstraintRegistrar[i].voteParams === undefined ? votingMachinesParams[0] : votingMachinesParams[migrationParams.GlobalConstraintRegistrar[i].voteParams],
        migrationParams.GlobalConstraintRegistrar[i].votingMachine === undefined ? GenesisProtocol : migrationParams.GlobalConstraintRegistrar[i].votingMachine
      )
      globalConstraintRegistrarParams = await globalConstraintRegistrarSetParams.call()
      tx = await globalConstraintRegistrarSetParams.send({ nonce: ++nonce })
      await logTx(tx, 'Global Constraints Registrar parameters set.')
      schemeNames.push('Global Constraints Registrar')
      schemes.push(GlobalConstraintRegistrar)
      params.push(globalConstraintRegistrarParams)
      permissions.push('0x00000004')
    }
  }

  if (migrationParams.schemes.UpgradeScheme) {
    for (let i in migrationParams.UpgradeScheme) {
      spinner.start('Setting Upgrade Scheme parameters...')
      const upgradeSchemeSetParams = upgradeScheme.methods.setParameters(
        migrationParams.UpgradeScheme[i].voteParams === undefined ? votingMachinesParams[0] : votingMachinesParams[migrationParams.UpgradeScheme[i].voteParams],
        migrationParams.UpgradeScheme[i].votingMachine === undefined ? GenesisProtocol : migrationParams.UpgradeScheme[i].votingMachine
      )
      upgradeSchemeParams = await upgradeSchemeSetParams.call()
      tx = await upgradeSchemeSetParams.send({ nonce: ++nonce })
      await logTx(tx, 'Upgrade Scheme parameters set.')
      schemeNames.push('Upgrade Scheme')
      schemes.push(UpgradeScheme)
      params.push(upgradeSchemeParams)
      permissions.push('0x0000000A')
    }
  }

  if (migrationParams.schemes.ReputationFromToken) {
    let { abi: reputationFromTokenABI, bytecode: reputationFromTokenBytecode } = require('@daostack/arc/build/contracts/ReputationFromToken.json')
    Schemes.ReputationFromToken = []
    for (let i in migrationParams.ReputationFromToken) {
      spinner.start('Migrating ReputationFromToken...')
      const reputationFromTokenContract = new web3.eth.Contract(reputationFromTokenABI, undefined, opts)
      const reputationFromTokenDeployedContract = reputationFromTokenContract.deploy({
        data: reputationFromTokenBytecode,
        arguments: null
      }).send({ nonce: ++nonce })
      tx = await new Promise(resolve => reputationFromTokenDeployedContract.on('receipt', resolve))
      const reputationFromToken = await reputationFromTokenDeployedContract
      await logTx(tx, `${reputationFromToken.options.address} => ReputationFromToken`)

      spinner.start('Setting ReputationFromToken...')
      let tokenContract = migrationParams.ReputationFromToken[i].tokenContract
      if (tokenContract === undefined || tokenContract === null) {
        let { abi: repAllocationABI, bytecode: repAllocationBytecode } = require('@daostack/arc/build/contracts/RepAllocation.json')
        spinner.start('Migrating RepAllocation...')
        const repAllocationContract = new web3.eth.Contract(repAllocationABI, undefined, opts)
        const repAllocationDeployedContract = repAllocationContract.deploy({
          data: repAllocationBytecode,
          arguments: null
        }).send({ nonce: ++nonce })
        tx = await new Promise(resolve => repAllocationDeployedContract.on('receipt', resolve))
        const repAllocation = await repAllocationDeployedContract
        await logTx(tx, `${repAllocation.options.address} => RepAllocation`)
        tokenContract = repAllocation.options.address
      }
      const reputationFromTokenInit = reputationFromToken.methods.initialize(
        avatar.options.address,
        tokenContract,
        migrationParams.ReputationFromToken[i].curve === undefined ? '0x0000000000000000000000000000000000000000' : migrationParams.ReputationFromToken[i].curve
      )
      tx = await reputationFromTokenInit.send({ nonce: ++nonce })
      await logTx(tx, 'Reputation From Token Scheme Initialized.')

      schemeNames.push('ReputationFromToken')
      schemes.push(reputationFromToken.options.address)
      params.push('0x0000000000000000000000000000000000000000000000000000000000000000')
      permissions.push('0x00000001')
      Schemes.ReputationFromToken.push(reputationFromToken.options.address)
    }
  }

  for (const schemeName in migrationParams.CustomSchemes) {
    Schemes[schemeName] = []
    for (let i in migrationParams.CustomSchemes[schemeName]) {
      let scheme = migrationParams.CustomSchemes[schemeName][i]
      const path = require('path')
      let { abi, bytecode } = require(path.resolve(`${customabislocation}/${schemeName}.json`))
      let schemeContract
      if (scheme.address === undefined) {
        spinner.start(`Migrating ${schemeName}...`)
        const SchemeContract = new web3.eth.Contract(abi, undefined, opts)
        const schemeDeployedContract = SchemeContract.deploy({
          data: bytecode,
          arguments: null
        }).send({ nonce: ++nonce })
        tx = await new Promise(resolve => schemeDeployedContract.on('receipt', resolve))
        schemeContract = await schemeDeployedContract
        await logTx(tx, `${schemeContract.options.address} => ${schemeName}`)
      } else {
        schemeContract = new web3.eth.Contract(abi, scheme.address, opts)
      }

      let schemeParamsHash = '0x0000000000000000000000000000000000000000000000000000000000000000'
      if (scheme.isUniversal) {
        spinner.start(`Setting ${schemeName} parameters...`)
        let schemeParams = []
        for (let i in scheme.params) {
          if (scheme.params[i].voteParams !== undefined) {
            schemeParams.push(votingMachinesParams[scheme.params[i].voteParams])
          } else if (scheme.params[i] === 'GenesisProtocolAddress') {
            schemeParams.push(GenesisProtocol)
          } else {
            schemeParams.push(scheme.params[i])
          }
        }
        const schemeSetParams = schemeContract.methods.setParameters(...schemeParams)
        schemeParamsHash = await schemeSetParams.call()
        tx = await schemeSetParams.send({ nonce: ++nonce })
        await logTx(tx, `${schemeName} parameters set.`)
      } else {
        spinner.start(`Initializing ${schemeName}...`)
        let schemeParams = [avatar.options.address]
        for (let i in scheme.params) {
          if (scheme.params[i].voteParams !== undefined) {
            schemeParams.push(votingMachinesParams[scheme.params[i].voteParams])
          } else {
            schemeParams.push(scheme.params[i])
          }
        }
        const schemeSetParams = schemeContract.methods.initialize(...schemeParams)
        schemeParamsHash = await schemeSetParams.call()
        if (schemeParamsHash.Result === undefined) {
          schemeParamsHash = '0x0000000000000000000000000000000000000000000000000000000000000000'
        }
        tx = await schemeSetParams.send({ nonce: ++nonce })
        await logTx(tx, `${schemeName} initialized.`)
      }

      schemeNames.push(schemeName)
      schemes.push(schemeContract.options.address)
      params.push(schemeParamsHash)
      permissions.push(scheme.permissions)
      Schemes[schemeName] = { alias: scheme.alias, address: schemeContract.options.address }
    }
  }

  if (migrationParams.useDaoCreator === true) {
    spinner.start('Setting DAO schemes...')
    tx = await daoCreator.methods.setSchemes(avatar.options.address, schemes, params, permissions, 'metaData').send({ nonce: ++nonce })
    await logTx(tx, 'DAO schemes set.')
  } else {
    for (let i in schemes) {
      spinner.start('Registering ' + schemeNames[i] + ' to the DAO...')
      tx = await controller.methods.registerScheme(schemes[i], params[i], permissions[i], avatar.options.address).send({ nonce: ++nonce })
      await logTx(tx, schemeNames[i] + ' was successfully registered to the DAO.')
    }
  }

  console.log(
    {
      name: orgName,
      Avatar: avatar.options.address,
      DAOToken: daoToken.options.address,
      Reputation: reputation.options.address,
      Controller,
      Schemes
    }
  )
  let migration = { 'dao': previousMigration.dao || {} }
  migration.dao[arcVersion] = {
    name: orgName,
    Avatar: avatar.options.address,
    DAOToken: daoToken.options.address,
    Reputation: reputation.options.address,
    Controller,
    Schemes
  }
  return migration
}

module.exports = migrateDAO
