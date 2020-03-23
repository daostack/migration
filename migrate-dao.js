const utils = require('./utils.js')
const sanitize = require('./sanitize')

async function migrateDAO ({ arcVersion, web3, spinner, confirm, opts, migrationParams, logTx, previousMigration, customAbisLocation, restart, getState, setState, cleanState, sendTx, getArcVersionNumber, optimizedAbis }) {
  let network = await web3.eth.net.getNetworkType()
  if (network === 'main') {
    network = 'mainnet'
  }

  if (network === 'private') {
    if (await web3.eth.net.getId() === 100) {
      network = 'xdai'
    } else if (await web3.eth.net.getId() === 77) {
      network = 'sokol'
    }
  }

  if (restart) {
    cleanState(network)
  }

  let contractsDir = 'contracts'
  if (optimizedAbis) {
    contractsDir = 'contracts-optimized'
  }

  let deploymentState = getState(network)

  // sanitize the parameters
  sanitize(migrationParams)

  let arcPackage = previousMigration.package
  if (!(await confirm('About to migrate new DAO. Continue?'))) {
    return
  }

  if (!arcPackage[arcVersion]) {
    const msg = `Couldn't find existing arcPackage migration ('migration.json' > 'arcPackage').`
    spinner.fail(msg)
    throw new Error(msg)
  }

  spinner.start('Migrating DAO...')
  let tx

  const {
    DAOFactoryInstance,
    GenesisProtocol
  } = arcPackage[arcVersion]

  const daoFactory = new web3.eth.Contract(
    utils.importAbi(`./${contractsDir}/${arcVersion}/DAOFactory.json`).abi,
    DAOFactoryInstance,
    opts
  )

  const genesisProtocol = new web3.eth.Contract(
    utils.importAbi(`./${contractsDir}/${arcVersion}/GenesisProtocol.json`).abi,
    GenesisProtocol,
    opts
  )

  let randomName = utils.generateRandomName()

  if (deploymentState.orgName !== undefined) {
    randomName = deploymentState.orgName
  }

  const [orgName, tokenName, tokenSymbol, tokenCap, founders] = [
    migrationParams.orgName !== undefined ? migrationParams.orgName : randomName,
    migrationParams.tokenName !== undefined ? migrationParams.tokenName : randomName + ' Token',
    migrationParams.tokenSymbol !== undefined ? migrationParams.tokenSymbol : randomName[0] + randomName.split(' ')[1][0] + 'T',
    migrationParams.tokenCap !== undefined ? migrationParams.tokenCap : 0,
    migrationParams.founders
  ]

  deploymentState.orgName = orgName

  let avatar
  let daoToken
  let reputation
  let controller

  if (deploymentState.Schemes === undefined) {
    deploymentState.Schemes = []
    deploymentState.StandAloneContracts = []
  }

  const [founderAddresses, tokenDist, repDist] = [
    founders.map(({ address }) => address),
    founders.map(({ tokens }) => web3.utils.toWei(tokens !== undefined ? tokens.toString() : '0')),
    founders.map(({ reputation }) => web3.utils.toWei(reputation !== undefined ? reputation.toString() : '0'))
  ]

  const initFoundersBatchSize = 20
  const foundersBatchSize = 100
  if (deploymentState.Avatar === undefined) {
    let foundersInitCount = founderAddresses.length < initFoundersBatchSize ? founderAddresses.length : initFoundersBatchSize
    let tokenData = await new web3.eth.Contract(utils.importAbi(`./${contractsDir}/${arcVersion}/DAOToken.json`).abi)
      .methods.initialize(tokenName, tokenSymbol, tokenCap, DAOFactoryInstance).encodeABI()
    const forgeOrg = daoFactory.methods.forgeOrg(
      orgName,
      tokenData,
      founderAddresses.slice(0, foundersInitCount),
      tokenDist.slice(0, foundersInitCount),
      repDist.slice(0, foundersInitCount),
      [0, 0, getArcVersionNumber(arcVersion)]
    )

    tx = (await sendTx(forgeOrg, 'Creating a new organization...')).receipt
    await logTx(tx, 'Created new organization.')
  }

  if (deploymentState.Avatar === undefined) {
    deploymentState.Avatar = tx.events.NewOrg.returnValues._avatar
    setState(deploymentState, network)
  }

  deploymentState.foundersToAddCount = deploymentState.foundersToAddCount === undefined ? founderAddresses.length - initFoundersBatchSize : deploymentState.foundersToAddCount
  deploymentState.foundersAdditionCounter = deploymentState.foundersAdditionCounter === undefined ? 0 : deploymentState.foundersAdditionCounter
  while (deploymentState.foundersToAddCount > 0) {
    let currentBatchCount = deploymentState.foundersToAddCount < foundersBatchSize ? deploymentState.foundersToAddCount : foundersBatchSize
    tx = (await sendTx(daoFactory.methods.addFounders(
      deploymentState.Avatar,
      founderAddresses.slice(deploymentState.foundersAdditionCounter * foundersBatchSize + initFoundersBatchSize,
        deploymentState.foundersAdditionCounter * foundersBatchSize + currentBatchCount + initFoundersBatchSize),
      tokenDist.slice(deploymentState.foundersAdditionCounter * foundersBatchSize + initFoundersBatchSize,
        deploymentState.foundersAdditionCounter * foundersBatchSize + currentBatchCount + initFoundersBatchSize),
      repDist.slice(deploymentState.foundersAdditionCounter * foundersBatchSize + initFoundersBatchSize,
        deploymentState.foundersAdditionCounter * foundersBatchSize + currentBatchCount + initFoundersBatchSize)
    ), 'Adding founders...')).receipt
    await logTx(tx, 'Finished adding founders.')

    deploymentState.foundersToAddCount -= foundersBatchSize
    deploymentState.foundersAdditionCounter++
    setState(deploymentState, network)
  }

  avatar = new web3.eth.Contract(
    utils.importAbi(`./${contractsDir}/${arcVersion}/Avatar.json`).abi,
    deploymentState.Avatar,
    opts
  )

  daoToken = new web3.eth.Contract(
    utils.importAbi(`./${contractsDir}/${arcVersion}/DAOToken.json`).abi,
    await avatar.methods.nativeToken().call(),
    opts
  )

  reputation = new web3.eth.Contract(
    utils.importAbi(`./${contractsDir}/${arcVersion}/Reputation.json`).abi,
    await avatar.methods.nativeReputation().call(),
    opts
  )

  controller = new web3.eth.Contract(
    utils.importAbi(`./${contractsDir}/${arcVersion}/Controller.json`).abi,
    await avatar.methods.owner().call(),
    opts
  )
  deploymentState.Controller = controller.options.address

  if (deploymentState.schemeNames === undefined) {
    deploymentState.schemes = []
    deploymentState.schemeNames = []
    deploymentState.schemesData = '0x'
    deploymentState.schemesInitializeDataLens = []
    deploymentState.permissions = []
    deploymentState.votingMachinesParams = []
  }

  if (migrationParams.VotingMachinesParams !== undefined && migrationParams.VotingMachinesParams.length > 0) {
    if (deploymentState.registeredGenesisProtocolParamsCount === undefined) {
      deploymentState.registeredGenesisProtocolParamsCount = 0
    }
    for (deploymentState.registeredGenesisProtocolParamsCount;
      deploymentState.registeredGenesisProtocolParamsCount < migrationParams.VotingMachinesParams.length;
      deploymentState.registeredGenesisProtocolParamsCount++) {
      setState(deploymentState, network)
      if (migrationParams.VotingMachinesParams[deploymentState.registeredGenesisProtocolParamsCount].votingParamsHash !== undefined) {
        deploymentState.votingMachinesParams.push(migrationParams.VotingMachinesParams[deploymentState.registeredGenesisProtocolParamsCount].votingParamsHash)
        setState(deploymentState, network)
        continue
      }
      let parameters = [
        [
          migrationParams.VotingMachinesParams[deploymentState.registeredGenesisProtocolParamsCount].queuedVoteRequiredPercentage.toString(),
          migrationParams.VotingMachinesParams[deploymentState.registeredGenesisProtocolParamsCount].queuedVotePeriodLimit.toString(),
          migrationParams.VotingMachinesParams[deploymentState.registeredGenesisProtocolParamsCount].boostedVotePeriodLimit.toString(),
          migrationParams.VotingMachinesParams[deploymentState.registeredGenesisProtocolParamsCount].preBoostedVotePeriodLimit.toString(),
          migrationParams.VotingMachinesParams[deploymentState.registeredGenesisProtocolParamsCount].thresholdConst.toString(),
          migrationParams.VotingMachinesParams[deploymentState.registeredGenesisProtocolParamsCount].quietEndingPeriod.toString(),
          web3.utils.toWei(migrationParams.VotingMachinesParams[deploymentState.registeredGenesisProtocolParamsCount].proposingRepReward.toString()),
          migrationParams.VotingMachinesParams[deploymentState.registeredGenesisProtocolParamsCount].votersReputationLossRatio.toString(),
          web3.utils.toWei(migrationParams.VotingMachinesParams[deploymentState.registeredGenesisProtocolParamsCount].minimumDaoBounty.toString()),
          migrationParams.VotingMachinesParams[deploymentState.registeredGenesisProtocolParamsCount].daoBountyConst.toString(),
          migrationParams.VotingMachinesParams[deploymentState.registeredGenesisProtocolParamsCount].activationTime.toString()
        ],
        migrationParams.VotingMachinesParams[deploymentState.registeredGenesisProtocolParamsCount].voteOnBehalf
      ]
      const genesisProtocolSetParams = genesisProtocol.methods.setParameters(...parameters)

      let votingMachinesParams = await genesisProtocolSetParams.call()
      const votingMachineCheckParams = await genesisProtocol.methods.parameters(votingMachinesParams).call()
      if (votingMachineCheckParams.minimumDaoBounty === '0') {
        tx = (await sendTx(genesisProtocolSetParams, 'Setting GenesisProtocol parameters...')).receipt
        await logTx(tx,
          'GenesisProtocol parameters set. | Params Hash: ' +
          votingMachinesParams + '\nParameters:\n' +
          parameters.toString().replace(/,/g, ',\n')
        )
      }

      deploymentState.votingMachinesParams.push(votingMachinesParams)
      setState(deploymentState, network)
    }
  }
  deploymentState.registeredGenesisProtocolParamsCount++
  setState(deploymentState, network)

  let runFunctions = async function (object, contract) {
    if (object.runFunctions !== undefined) {
      for (let i in object.runFunctions) {
        let functionParams = []
        for (let j in object.runFunctions[i].params) {
          if (object.runFunctions[i].params[j].StandAloneContract !== undefined) {
            functionParams.push(deploymentState.StandAloneContracts[object.runFunctions[i].params[j].StandAloneContract].address)
          } else if (object.runFunctions[i].params[j] === 'AvatarAddress') {
            functionParams.push(avatar.options.address)
          } else {
            functionParams.push(object.runFunctions[i].params[j])
          }
        }
        const functionCall = contract.methods[object.runFunctions[i].functionName](...functionParams)

        tx = (await sendTx(functionCall, `Calling ${object.name} - ${object.runFunctions[i].functionName}...`)).receipt
        await logTx(tx, `${object.name} called function ${object.runFunctions[i].functionName}.`)
      }
    }
  }

  if (migrationParams.StandAloneContracts) {
    let len = migrationParams.StandAloneContracts.length
    if (deploymentState.standAloneContractsCounter === undefined) {
      deploymentState.standAloneContractsCounter = 0
    }
    for (deploymentState.standAloneContractsCounter;
      deploymentState.standAloneContractsCounter < len;
      deploymentState.standAloneContractsCounter++) {
      setState(deploymentState, network)
      let standAlone = migrationParams.StandAloneContracts[deploymentState.standAloneContractsCounter]

      const path = require('path')
      let contractJson
      if (standAlone.fromArc) {
        contractJson = utils.importAbi(`./${contractsDir}/${standAlone.arcVersion ? standAlone.arcVersion : arcVersion}/${standAlone.name}.json`)
      } else {
        contractJson = require(path.resolve(`${customAbisLocation}/${standAlone.name}.json`))
      }
      let abi = contractJson.abi
      let bytecode = contractJson.bytecode
      let contractParams = []

      const StandAloneContract = new web3.eth.Contract(abi, undefined, opts)

      if (standAlone.params !== undefined) {
        for (let i in standAlone.params) {
          if (standAlone.params[i].StandAloneContract !== undefined) {
            contractParams.push(deploymentState.StandAloneContracts[standAlone.params[i].StandAloneContract].address)
          } else if (standAlone.params[i] === 'DefaultAccount') {
            contractParams.push(web3.eth.defaultAccount)
          } else {
            contractParams.push(standAlone.params[i])
          }
        }
      }

      // Allow create as proxy
      let standAloneContract
      if (standAlone.fromArc) {
        const contractInitParams = (standAlone.params !== undefined && standAlone.params.length > 0)
          ? StandAloneContract.methods.initialize(...contractParams).encodeABI()
          : '0x'
        let createStandAloneProxyInstance = daoFactory.methods.createInstance(
          [0, 1, getArcVersionNumber(standAlone.arcVersion ? standAlone.arcVersion : arcVersion)],
          standAlone.name,
          avatar.options.address,
          contractInitParams
        )
        tx = (await sendTx(createStandAloneProxyInstance, `Creating ${standAlone.name} Proxy Instance...`)).receipt
        standAloneContract = new web3.eth.Contract(abi, tx.events.ProxyCreated.returnValues._proxy, opts)
        await logTx(tx, `${standAloneContract.options.address} => ${standAlone.name}`)
      } else {
        const { receipt, result: standAloneContractRes } = await sendTx(StandAloneContract.deploy({
          data: bytecode,
          arguments: standAlone.constructor ? contractParams : null
        }), `Migrating ${standAlone.name}...`)
        standAloneContract = standAloneContractRes
        await logTx(receipt, `${standAloneContract.options.address} => ${standAlone.name}`)

        if (standAlone.constructor !== true && standAlone.params !== undefined) {
          const contractSetParams = standAloneContract.methods.initialize(...contractParams)

          tx = (await sendTx(contractSetParams, `Initializing ${standAlone.name}...`)).receipt
          await logTx(tx, `${standAlone.name} initialized.`)
        }
      }

      await runFunctions(standAlone, standAloneContract)

      deploymentState.StandAloneContracts.push(
        {
          name: standAlone.name,
          alias: standAlone.alias,
          address: standAloneContract.options.address,
          arcVersion: (standAlone.arcVersion ? standAlone.arcVersion : arcVersion)
        }
      )
      setState(deploymentState, network)
    }
    deploymentState.standAloneContractsCounter++
    setState(deploymentState, network)
  }

  if (migrationParams.Schemes) {
    let len = migrationParams.Schemes.length
    if (deploymentState.SchemeCounter === undefined) {
      deploymentState.SchemeCounter = 0
    }
    for (deploymentState.SchemeCounter;
      deploymentState.SchemeCounter < len; deploymentState.SchemeCounter++) {
      setState(deploymentState, network)
      let scheme = migrationParams.Schemes[deploymentState.SchemeCounter]

      let schemeParams = [avatar.options.address]
      for (let i in scheme.params) {
        if (scheme.params[i].voteParams !== undefined) {
          schemeParams.push(deploymentState.votingMachinesParams[scheme.params[i].voteParams])
        } else if (scheme.params[i] === 'GenesisProtocolAddress') {
          schemeParams.push(GenesisProtocol)
        } else if (scheme.params[i].StandAloneContract !== undefined) {
          schemeParams.push(deploymentState.StandAloneContracts[scheme.params[i].StandAloneContract].address)
        } else if (scheme.params[i].packageContract !== undefined) {
          schemeParams.push(arcPackage[arcVersion][scheme.params[i].packageContract])
        } else if (scheme.params[i] === 'AvatarAddress') {
          schemeParams.push(avatar.options.address)
        } else {
          schemeParams.push(scheme.params[i])
        }
      }

      let schemeData = await new web3.eth.Contract(utils.importAbi(`./${contractsDir}/${arcVersion}/${scheme.name}.json`).abi)
        .methods.initialize(...schemeParams).encodeABI()

      deploymentState.schemeNames.push(web3.utils.fromAscii(scheme.name))
      deploymentState.schemesData = utils.concatBytes(deploymentState.schemesData, schemeData)
      deploymentState.schemesInitializeDataLens.push(utils.getBytesLength(schemeData))
      deploymentState.permissions.push(scheme.permissions)
      setState(deploymentState, network)
    }
    deploymentState.SchemeCounter++
    setState(deploymentState, network)
  }

  if (deploymentState.schemesSet !== true) {
    tx = (await sendTx(
      daoFactory.methods.setSchemes(
        avatar.options.address,
        deploymentState.schemeNames,
        deploymentState.schemesData,
        deploymentState.schemesInitializeDataLens,
        deploymentState.permissions,
        migrationParams.metaData !== undefined ? migrationParams.metaData : 'metaData'
      ), 'Setting DAO schemes...')).receipt
    await logTx(tx, 'DAO schemes set.')

    let schemesEvents = tx.events.SchemeInstance
    for (let i in schemesEvents) {
      deploymentState.Schemes.push(
        {
          name: web3.utils.toAscii(deploymentState.schemeNames[i]),
          alias: migrationParams.Schemes[i].alias,
          address: schemesEvents[i].returnValues._scheme
        })
    }

    deploymentState.schemesSet = true
    setState(deploymentState, network)
  }

  // Special code for Competition deployment
  if (migrationParams.Schemes) {
    let len = migrationParams.Schemes.length
    if (deploymentState.SchemeAfterCounter === undefined) {
      deploymentState.SchemeAfterCounter = 0
    }
    for (deploymentState.SchemeAfterCounter;
      deploymentState.SchemeAfterCounter < len; deploymentState.SchemeAfterCounter++) {
      setState(deploymentState, network)
      let scheme = migrationParams.Schemes[deploymentState.SchemeAfterCounter]

      if (scheme.name === 'ContributionRewardExt' && scheme.useCompetition === true) {
        let competitionAddress = scheme.params[2]
        if (competitionAddress.StandAloneContract !== undefined) {
          competitionAddress = deploymentState.StandAloneContracts[competitionAddress.StandAloneContract].address
        }
        let initCompetition = await new web3.eth.Contract(
          utils.importAbi(`./${contractsDir}/${arcVersion}/Competition.json`).abi,
          competitionAddress,
          opts).methods.initialize(deploymentState.Schemes[deploymentState.SchemeAfterCounter].address)
        tx = (await sendTx(initCompetition, `Initializing competition with ContributionRewardExt address...`)).receipt
        await logTx(tx,
          `Initialized competition with rewarder: ${deploymentState.Schemes[deploymentState.SchemeAfterCounter].address}.`)
      }
      setState(deploymentState, network)
    }
    deploymentState.SchemeAfterCounter++
    setState(deploymentState, network)
  }

  let dao = {
    name: orgName,
    Avatar: avatar.options.address,
    DAOToken: daoToken.options.address,
    Reputation: reputation.options.address,
    Controller: deploymentState.Controller,
    Schemes: deploymentState.Schemes,
    StandAloneContracts: deploymentState.StandAloneContracts,
    arcVersion
  }
  console.log(JSON.stringify(dao, null, 2))
  let migration = { 'dao': previousMigration.dao || {} }
  migration.dao[arcVersion] = dao

  cleanState(network)
  spinner.succeed('DAO Migration has Finished Successfully!')
  return migration
}

module.exports = migrateDAO
