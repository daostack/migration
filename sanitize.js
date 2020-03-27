const Web3Utils = require('web3-utils')
const Validator = require('jsonschema').Validator
const validator = new Validator()

const requiredNumber = {
  type: 'number',
  required: true
}

const requiredInteger = {
  type: 'integer',
  required: true
}

const requiredString = {
  type: 'string',
  required: true
}

Validator.prototype.customFormats.Address = function (input) {
  if (typeof input !== 'string') {
    return false
  }

  const addr = input.toLowerCase()
  return addr[0] === '0' && addr[1] === 'x' && Web3Utils.isAddress(addr)
}

const address = {
  id: 'Address',
  type: 'string',
  format: 'Address'
}
validator.addSchema(address)

Validator.prototype.customFormats.Permissions = function (input) {
  return input[0] === '0' && input[1] === 'x' &&
         input.length === 10 && Web3Utils.isHex(input)
}

const permissions = {
  id: 'Permissions',
  type: 'string',
  format: 'Permissions'
}
validator.addSchema(permissions)

const genesisProtocol = {
  id: 'GenesisProtocol',
  type: 'object',
  properties: {
    boostedVotePeriodLimit: requiredNumber,
    daoBountyConst: requiredNumber,
    minimumDaoBounty: requiredNumber,
    queuedVotePeriodLimit: requiredNumber,
    queuedVoteRequiredPercentage: requiredNumber,
    preBoostedVotePeriodLimit: requiredNumber,
    proposingRepReward: requiredNumber,
    quietEndingPeriod: requiredNumber,
    thresholdConst: requiredNumber,
    voteOnBehalf: { $ref: 'Address', require: true },
    votersReputationLossRatio: requiredNumber,
    activationTime: requiredNumber
  }
}
validator.addSchema(genesisProtocol)

const votingMachineParams = {
  id: 'VotingMachineParams',
  type: 'array',
  items: { $ref: 'GenesisProtocol' },
  minItems: 1
}
validator.addSchema(votingMachineParams)

const packageContract = {
  id: 'PackageContract',
  type: 'object',
  properties: {
    packageContract: requiredString
  }
}
validator.addSchema(packageContract)

Validator.prototype.customFormats.ExternalContractAddress = function (input) {
  return Validator.prototype.customFormats.VotingMachineAddress(input) ||
    input === 'Avatar'
}

const externalContractAddress = {
  id: 'ExternalContractAddress',
  type: 'string',
  format: 'ExternalContractAddress'
}
validator.addSchema(externalContractAddress)

const standAloneIndex = {
  id: 'StandAloneIndex',
  properties: {
    StandAloneContract: {
      ...requiredInteger,
      minimum: 0
    }
  }
}
validator.addSchema(standAloneIndex)

const addressOrStandAlone = {
  id: 'AddressOrStandAlone',
  anyOf: [
    { $ref: 'Address' },
    { $ref: 'StandAloneIndex' }
  ]
}
validator.addSchema(addressOrStandAlone)

Validator.prototype.customFormats.VotingMachineAddress = function (input) {
  return Validator.prototype.customFormats.Address(input) ||
    input === 'GenesisProtocolAddress'
}

const votingMachineAddress = { 
  id: 'VotingMachineAddress',
  type: 'string',
  format: 'VotingMachineAddress',
}
validator.addSchema(votingMachineAddress)

const votingMachineParamsIndex = {
  id: 'VotingMachineParamsIndex',
  type: 'object',
  properties: {
    voteParams: {
      ...requiredInteger,
      minimum: 0
    }
  }
}
validator.addSchema(votingMachineParamsIndex)

const schemes = {
  id: 'Schemes',
  type: 'array',
  items: {
    anyOf: [
      { $ref: 'ContributionReward' },
      { $ref: 'SchemeRegistrar' },
      { $ref: 'GlobalConstraintRegistrar' },
      { $ref: 'UpgradeScheme' },
      { $ref: 'GenericScheme' },
      { $ref: 'ContributionRewardExt' },
      { $ref: 'SchemeFactory' }
    ],
    required: [
      'name',
      'alias',
      'permissions',
      'params'
    ]
  }
}
validator.addSchema(schemes)

const addSchemeProposalParams = (schemeName, vmParamsNum, params) => {
  const schema = {
    id: `${schemeName}Params`,
    type: 'array',
    items: [
      { $ref: 'VotingMachineAddress' },
      ...new Array(vmParamsNum).map(() => (
        { $ref: 'VotingMachineParamsIndex' }
      )),
      ...params
    ]
  }
  schema.minItems =
  schema.maxItems = schema.items.length
  validator.addSchema(schema)
}

const addScheme = (schemeName, vmParamsNum = 1, params = []) => {
  addSchemeProposalParams(schemeName, vmParamsNum, params)

  const schema = {
    id: schemeName,
    type: 'object',
    properties: {
      name: {
        ...requiredString,
        pattern: new RegExp(`^${schemeName}$`)
      },
      permissions: { $ref: 'Permissions', required: true },
      alias: requiredString,
      params: {
        $ref: `${schemeName}Params`,
        required: true
      }
    }
  }

  validator.addSchema(schema)
}

addScheme('ContributionReward')
addScheme('SchemeRegistrar', 2)
addScheme('GlobalConstraintRegistrar')
addScheme('UpgradeScheme', 1, [{ $ref: 'PackageContract' }])
addScheme('GenericScheme', 1, [{ $ref: 'ExternalContractAddress' }])
addScheme('ContributionRewardExt', 1, [{ $ref: 'AddressOrStandAlone' }])
addScheme('SchemeFactory', 1, [{ $ref: 'PackageContract' }])

const member = {
  id: 'Member',
  type: 'object',
  properties: {
    address: { $ref: 'Address', required: true },
    tokens: { type: 'number' },
    reputation: requiredNumber
  }
}
validator.addSchema(member)

const founders = {
  id: 'Founders',
  type: 'array',
  items: { $ref: 'Member' },
  minItems: 1
}
validator.addSchema(founders)

const paramsSchema = {
  id: 'Params',
  type: 'object',
  properties: {
    orgName: { type: 'string' },
    tokenName: { type: 'string' },
    tokenSymbol: { type: 'string' },
    tokenCap: { type: 'number' },
    metaData: { type: 'string' },
    VotingMachineParams: {
      $ref: 'VotingMachineParams',
      required: true
    },
    Schemes: {
      $ref: 'Schemes',
      require: true
    },
    // TODO: implement these
    /*
    StandAloneContracts: { $ref: 'StandAloneContracts' },
    runFunctions: { $ref: 'RunFunctions' },
    */
    founders: {
      $ref: 'Founders',
      required: true
    },
    // network overrides
    mainnet: { type: 'object' },
    rinkeby: { type: 'object' },
    private: { type: 'object' },
    ropsten: { type: 'object' },
    kovan: { type: 'object' },
    xdai: { type: 'object' }
  }
}

function sanitizeParams (paramsJsonObj) {
  const result = validator.validate(paramsJsonObj, paramsSchema)

  if (!result.valid) {
    throw Error(
      `Params Malformed, Errors:\n${result.errors.map(error => error.toString())}`
    )
  }
}

const params = {
  "orgName": "My DAO",
  "tokenName": "My DAO Token",
  "tokenSymbol": "MY",
  "tokenCap": 0,
  "metaData": "Deployment Metadata",
  "VotingMachinesParams": [
    {
      "boostedVotePeriodLimit": 600,
      "daoBountyConst": 10,
      "minimumDaoBounty": 100,
      "queuedVotePeriodLimit": 1800,
      "queuedVoteRequiredPercentage": 50,
      "preBoostedVotePeriodLimit": 600,
      "proposingRepReward": 5,
      "quietEndingPeriod": 300,
      "thresholdConst": 2000,
      "voteOnBehalf": "0x0000000000000000000000000000000000000000",
      "votersReputationLossRatio": 1,
      "activationTime": 0
    }
  ],
  "Schemes": [
    {
      "name": "ContributionReward",
      "alias" : "ContributionRewardAlias",
      "permissions": "0x00000000",
      "params": [
        "GenesisProtocolAddress",
        { "voteParams": 0 }
      ]
    },
    {
      "name": "SchemeRegistrar",
      "alias" : "SchemeRegistrarAlias",
      "permissions": "0x0000001F",
      "params": [
        "GenesisProtocolAddress",
        { "voteParams": 0 },
        { "voteParams": 0 }
      ]
    },
    {
      "name": "GlobalConstraintRegistrar",
      "alias" : "GlobalConstraintRegistrarAlias",
      "permissions": "0x00000004",
      "params": [
        "GenesisProtocolAddress",
        { "voteParams": 0 }
      ]
    },
    {
      "name": "UpgradeScheme",
      "alias" : "UpgradeSchemeAlias",
      "permissions": "0x00000010",
      "params": [
        "GenesisProtocolAddress",
        { "voteParams": 0 },
        { "packageContract": "Package" }
      ]
    },
    {
      "name": "GenericScheme",
      "alias" : "GenericSchemeAlias",
      "permissions": "0x00000010",
      "params": [
        "GenesisProtocolAddress",
        { "voteParams": 0 },
        "0x0000000000000000000000000000000000000000"
      ]
    },
    {
      "name": "GenericScheme",
      "alias" : "GenericSchemeAlias2",
      "permissions": "0x00000010",
      "params": [
        "GenesisProtocolAddress",
        { "voteParams": 0 },
        "0x0000000000000000000000000000000000000001"
      ]
    },
    {
      "name":"ContributionRewardExt",
      "alias":"ContributionRewardExt",
      "permissions":"0x00000000",
      "params":[
        "GenesisProtocolAddress",
        { "voteParams": 0 },
        { "StandAloneContract": 1 }
      ],
      // TODO: implement this
      "useCompetition": true
    },
    {
      "name": "SchemeFactory",
      "alias" : "SchemeRegistrarAlias",
      "permissions": "0x0000001F",
      "params": [
        "GenesisProtocolAddress",
        { "voteParams": 0 },
        { "packageContract": "DAOFactoryInstance" }
      ]
    }
  ],
  "StandAloneContracts": [
    {
      "name": "Wallet",
      "fromArc": true,
      "params": [
        "DefaultAccount"
      ],
      "runFunctions": [
        {
          "functionName": "transferOwnership",
          "params": [
            "AvatarAddress"
          ]
        }
      ]
    },
    {
      "name": "Competition",
      "fromArc": true
    }
  ],
  "runFunctions": [
    {
      "contract": { "StandAloneContract": 1 },
      "contractName": "Competition",
      "functionName": "initialize",
      "params": [
        { "Scheme": 6 }
      ]
    }
  ],
  "founders": [
    {
      "address": "0x90f8bf6a479f320ead074411a4b0e7944ea8c9c1",
      "tokens": 1000,
      "reputation": 1000
    },
    {
      "address": "0xffcf8fdee72ac11b5c542428b35eef5769c409f0",
      "tokens": 1000,
      "reputation": 1000
    },
    {
      "address": "0x22d491bde2303f2f43325b2108d26f1eaba1e32b",
      "tokens": 1000,
      "reputation": 1000
    },
    {
      "address": "0xe11ba2b4d45eaed5996cd0823791e0c93114882d",
      "tokens": 1000,
      "reputation": 1000
    },
    {
      "address": "0xd03ea8624c8c5987235048901fb614fdca89b117",
      "tokens": 1000,
      "reputation": 1000
    },
    {
      "address": "0x95ced938f7991cd0dfcb48f0a06a40fa1af46ebc",
      "tokens": 1000,
      "reputation": 1000
    }
  ]
}

sanitizeParams(params)

module.exports = sanitizeParams
