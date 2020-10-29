const axios = require('axios')
axios.defaults.timeout = 30000

const Web3 = require('web3')
const web3 = new Web3()
const BN = require('bn.js')

async function getLegacyDAOParameters (daoId, subgraphEndpoint) {
  let voteParasQuery = `
      boostedVotePeriodLimit
      daoBountyConst
      minimumDaoBounty
      queuedVotePeriodLimit
      queuedVoteRequiredPercentage
      preBoostedVotePeriodLimit
      proposingRepReward
      quietEndingPeriod
      thresholdConst
      voteOnBehalf
      votersReputationLossRatio
      activationTime
  `
  const query = `{
    dao(id: "${daoId}") {
      id
      name
      nativeToken {
        id
        name
        symbol
      }
      reputationHolders(first: 1000) {
        balance
        address
      }
      reputationHoldersCount
      schemes {
        isRegistered
        name
        alias
        canDelegateCall
        canRegisterSchemes
        canUpgradeController
        canManageGlobalConstraints
        genericSchemeParams {
          voteParams {
            ${voteParasQuery}
          }
          contractToCall
        }
        schemeFactoryParams {
          voteParams {
            ${voteParasQuery}
          }
          daoFactory
        }
        contributionRewardParams {
          voteParams {
            ${voteParasQuery}
          }
        }
        contributionRewardExtParams {
          voteParams {
            ${voteParasQuery}
          }
          rewarder
        }
      }
    }
  }`
  try {
    let { data } = (await axios.post(subgraphEndpoint, { query })).data
    let { dao } = data
    let migrationParams = {
      founders: [],
      Schemes: [],
      VotingMachinesParams: []
    }
    migrationParams.orgName = dao.name
    migrationParams.tokenName = dao.nativeToken.name
    migrationParams.tokenSymbol = dao.nativeToken.symbol
    // TODO: is tokenCap needed?
    migrationParams.tokenCap = 0
    // TODO: Legacy DAOs had no metadata, we should maybe ask for user input for this
    migrationParams.metaData = ''
    if (dao.reputationHoldersCount > 1000) {
      // TODO: Might need to handle edge case of more than 1000 reputation holders, let's check if any such exist
      console.log('Error: Too many rep holders')
    }
    for (let reputationHolder of dao.reputationHolders) {
      // TODO: DO we need DAOToken too?
      migrationParams.founders.push({
        tokens: 0,
        reputation: web3.utils.fromWei(reputationHolder.balance),
        address: reputationHolder.address
      })
    }
    // TODO: Maybe handle more than 1000 token holders.
    const tokenHoldersQuery = `{
      tokenHolders(where: {contract: "${dao.nativeToken.id}"}, first: 1000) {
        contract
        address
        balance
      }
    }`
    let { tokenHolders } = (await axios.post(subgraphEndpoint, { query: tokenHoldersQuery })).data.data
    for (let tokenHolder of tokenHolders) {
      let existingFounder = false
      for (let i in migrationParams.founders) {
        if (tokenHolder.address === migrationParams.founders[i].address) {
          existingFounder = true
          migrationParams.founders[i].tokens = web3.utils.fromWei(tokenHolder.balance)
          break
        }
      }
      if (!existingFounder) {
        migrationParams.founders.push({
          tokens: web3.utils.fromWei(tokenHolder.balance),
          reputation: 0,
          address: tokenHolder.address
        })
      }
    }
    let i = 0
    for (let scheme of dao.schemes) {
      if (!scheme.isRegistered) {
        continue
      }
      let permissions = '0x00000000'
      if (scheme.canRegisterSchemes) {
        permissions = '0x0000001F'
      } else if (scheme.canDelegateCall) {
        permissions = '0x00000010'
      } else if (scheme.canUpgradeController) {
        permissions = '0x0000000A'
      } else if (scheme.canManageGlobalConstraints) {
        permissions = '0x00000004'
      }

      let schemeName = scheme.name
      let schemeParamsName = ''
      let params
      let voteParamsName = 'voteParams'
      if (scheme.genericSchemeParams !== null) {
        schemeParamsName = 'genericSchemeParams'
        params = [
          'GenesisProtocolAddress',
          { voteParams: i },
          scheme[schemeParamsName].contractToCall
        ]
      } else if (scheme.schemeFactoryParams !== null) {
        schemeName = 'SchemeFactory'
        schemeParamsName = 'schemeFactoryParams'
        voteParamsName = 'voteParams'
        params = [
          'GenesisProtocolAddress',
          { voteParams: i },
          { packageContract: scheme[schemeParamsName].daoFactory }
        ]
      } else if (scheme.contributionRewardParams !== null) {
        schemeParamsName = 'contributionRewardParams'
        params = [
          'GenesisProtocolAddress',
          { voteParams: i }
        ]
      } else if (scheme.contributionRewardExtParams !== null) {
        schemeParamsName = 'contributionRewardExtParams'
        params = [
          'GenesisProtocolAddress',
          { voteParams: i },
          { packageContract: 'DAOFactoryInstance' },
          'PackageVersion',
          'Competition'
        ]
      }

      if (schemeParamsName === '') {
        console.log('Cannot migrate this scheme ' + scheme.name)
        continue
      }
      i++
      migrationParams.VotingMachinesParams.push({
        boostedVotePeriodLimit: scheme[schemeParamsName][voteParamsName].boostedVotePeriodLimit,
        daoBountyConst: scheme[schemeParamsName][voteParamsName].daoBountyConst,
        minimumDaoBounty: scheme[schemeParamsName][voteParamsName].minimumDaoBounty,
        queuedVotePeriodLimit: scheme[schemeParamsName][voteParamsName].queuedVotePeriodLimit,
        queuedVoteRequiredPercentage: scheme[schemeParamsName][voteParamsName].queuedVoteRequiredPercentage,
        preBoostedVotePeriodLimit: scheme[schemeParamsName][voteParamsName].preBoostedVotePeriodLimit,
        proposingRepReward: scheme[schemeParamsName][voteParamsName].proposingRepReward,
        quietEndingPeriod: scheme[schemeParamsName][voteParamsName].quietEndingPeriod,
        thresholdConst: realMathToNumber(new BN(scheme[schemeParamsName][voteParamsName].thresholdConst)),
        voteOnBehalf: scheme[schemeParamsName][voteParamsName].voteOnBehalf,
        votersReputationLossRatio: scheme[schemeParamsName][voteParamsName].votersReputationLossRatio,
        activationTime: scheme[schemeParamsName][voteParamsName].activationTime
      })
      migrationParams.Schemes.push({
        name: schemeName,
        alias: scheme.alias,
        permissions,
        params
      })
    }
    console.log(JSON.stringify(migrationParams, null, 2))
    return migrationParams
  } catch (e) {
    console.log(e)
  }
}

function realMathToNumber (t) {
  const REAL_FBITS = 40
  const fraction = t.maskn(REAL_FBITS).toNumber() / Math.pow(2, REAL_FBITS)
  return Math.round((t.shrn(REAL_FBITS).toNumber() + fraction) * 1000)
}

if (require.main === module) {
  let cliArgs = process.argv.slice(2)
  let daoId = cliArgs[0]
  let subgraphEndpoint = cliArgs[1]
  getLegacyDAOParameters(daoId, subgraphEndpoint)
} else {
  module.exports = {
    getLegacyDAOParameters
  }
}
