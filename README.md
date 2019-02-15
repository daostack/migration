[![npm (scoped)](https://img.shields.io/npm/v/@daostack/migration.svg)](https://www.npmjs.com/package/@daostack/migration)
[![Docker Pulls](https://img.shields.io/docker/pulls/daostack/migration.svg)](https://hub.docker.com/r/daostack/migration/)

# DAOstack Migration

A repo for handeling the migration of DAOstack contracts and DAOs. This repo is packaged both as an
[npm package](https://www.npmjs.com/package/@daostack/migration) and a
[Docker image](https://hub.docker.com/r/daostack/migration/) that exposes a pre-migrated ganache instance and other
utilities related to migration.

Migration is seperated into two phases:

1. Base migration - of universal contracts from the [`@daostack/arc`](https://www.npmjs.com/package/@daostack/arc)
   package.
2. DAO migration - of an [example DAO](#The_Example_DAO).

#### Versioning

Both the npm package and the docker image are versioned according to the `@daostack/arc` package and the migration
version. Example: `@daostack/arc@<arc version>` -> npm: `@daostack/ganache@<arcversion>-v<migration version>` and
dockerhub: `daostack/ganache:X.Y.Z-v<migration version>`

## Usage

### As a library

1. `npm install --save @daostack/migration`
2.

```javascript
const DAOstackMigration = require('@daostack/migration');

// ganache-core object with already migrated contracts
// options are as specified in https://github.com/trufflesuite/ganache-cli#library
DAOstackMigration.Ganache.server(..);
DAOstackMigration.Ganache.provider(..);
// migration result object for ganache
DAOstackMigration.migration('private');

const options = {
  // web3 provider url
  provider: 'http://localhost:8545',
  // gas price in GWei. If not specified, will use an automatically suggested price.
  gasPrice: 3.4,
  // surpress console output
  quiet: true,
  // disable confirmation messages
  force: true,
  // filepath to output the migration results
  output: 'migration.json',
  // private key of the account used in migration (overrides the 'mnemonic' option)
  privateKey: '0x123...',
  // mnemonic used to generate the private key of the account used in migration
	mnemonic: 'one two three ...',
	// migration parameters
	params: {
		default: {
			// migration params as defined in the "Migration parameters" section below
		},
		private: {
			// overide defaults on private network
		},
		kovan: {
			// overide defaults on kovan
		},
	},
};

// migrate base contracts
const migrationBaseResult = await DAOstackMigration.migrateBase(options);
migrationBaseResult.base.GenesisProtocol // migrated genesis protocol address
// migrate an example DAO (requires an existing `output` file with a base migration)
const migrationDAOResult = await DAOstackMigration.migrateDAO(options);
migrationDAOResult.dao.Avatar // DAO avatar address
// migrate an demo test scenario (requires an existing `output` file with a base migration)
const migrationDemoResult = await DAOstackMigration.migrateDemoTest(options);
migrationDemoResult.test.Avatar // Test DAO avatar address
// migrate base, example DAO and demo test contracts
const migrationResult = await DAOstackMigration.migrate(options); // migrate

// run the cli
DAOstackMigration.cli()
```

### As a CLI

1. `npm install --global @daostack/migration`

Usage:

```
Migrate base contracts and an example DAO

Commands:
  daostack-migrate             Migrate base contracts and an example DAO                                             [default]
  daostack-migrate base        Migrate base contracts
  daostack-migrate dao         Migrate an example DAO
  daostack-migrate completion  generate bash completion script

Options:
  --version          Show version number                                                                       [boolean]
  --provider, -p     web3 provider url                                       [string] [default: "http://localhost:8545"]
  --gas-price, -g    gas price in GWei. If not specified, will use an automatically suggested price.            [number]
  --quiet, -q        surpress console output                                                  [boolean] [default: false]
  --force, -f        disable confirmation messages                                            [boolean] [default: false]
  --output, -o       filepath to output the migration results                       [string] [default: "migration.json"]
  --params, -i       path to the file containing the migration parameters           [string] [default: "migration-params.json"]
  --private-key, -s  private key of the account used in migration (cannot be used with the 'mnemonic' option)
                                [string] [default: "0x4f3edf983ac636a65a842ce7c78d9aa706d3b113bce9c46f30d7d21715b23b1d"]
  --mnemonic, -m     mnemonic used to generate the private key of the account used in migration (cannot be used with the
                     'private-key' option)                                                                      [string]
  --help             Show help                                                                                 [boolean]
```

### As a docker image

1. `docker pull daostack/migration`
2. Run: `docker run --rm --name=ganache daostack/migration:0.0.0-alpha.56-v7 <ganache-cli arguments>`
3. Fetch migration result file: `docker exec ganache cat migration.json`
4. Fetch migration params file: `docker exec ganache cat migration-params.json`

## Migration result

Example migration result object:

```json
{
	"base": {
		"DAOToken": "0x123...",
		"ControllerCreator": "0x123...",
		"DaoCreator": "0x123...",
		"UController": "0x123...",
		"GenesisProtocol": "0x123...",
		"SchemeRegistrar": "0x123...",
		"UpgradeScheme": "0x123...",
		"GlobalConstraintRegistrar": "0x123...",
		"ContributionReward": "0x123...",
		"AbsoluteVote": "0x123...",
		"QuorumVote": "0x123...",
		"TokenCapGC": "0x123...",
		"VestingScheme": "0x123...",
		"VoteInOrganizationScheme": "0x123...",
		"OrganizationRegister": "0x123...",
		"Redeemer": "0x123..."
	},
	"dao": {
		"name": "DAO Jones",
		"Avatar": "0x123...",
		"NativeToken": "0x123...",
		"NativeReputation": "0x123..."
	},
	"test": {
      		"name": "0x123...",
      		"Avatar": "0x123...",
      		"NativeToken": "0x123...",
      		"NativeReputation": "0x123...",
      		"proposalId": "0xabc..."
    	}
}
```

## Migration parameters

Example migration parameters object:

```json
{
	"ContributionReward": {
		"orgNativeTokenFeeGWei": 0
	},
	"AbsoluteVote": {
		"voteOnBehalf": "0x0000000000000000000000000000000000000000",
		"votePerc": 50
	},
	"GenesisProtocol": {
      "boostedVotePeriodLimit": 259200,
      "daoBountyConst": 75,
      "minimumDaoBountyGWei": 100,
      "queuedVotePeriodLimit": 1814400,
      "queuedVoteRequiredPercentage": 50,
      "preBoostedVotePeriodLimit": 259200,
      "proposingRepRewardGwei": 5,
      "quietEndingPeriod": 86400,
      "thresholdConst": 2000,
      "voteOnBehalf": "0x0000000000000000000000000000000000000000",
      "votersReputationLossRatio": 1
	},
	"founders": [
		{
			"address": "0x123",
			"tokens": 1000,
			"reputation": 1000
		},
		//...
		{
			"address": "0x321",
			"tokens": 1000,
			"reputation": 1000
		}
	]
}
```

## The Example DAO

The migrated DAO is a simple DAO with the following configuration:

- using `UController` as a controller.
- founders - first 5 accounts generated from `mnemonic` each with `1000` native token and `1000` reputation.
- no native token cap.
- schemes:
  - `SchemeRegistrar`
    - permissions: all permissions (`0x0000001F`)
    - voting machine: `AbsoluteVote(votePerc=50,voteOnBehalf="0x0000000000000000000000000000000000000000")`
  - `GlobalConstraintRegistrar`
    - permissions: manage global constraints (`0x00000004`)
    - voting machine: `AbsoluteVote(votePerc=50,voteOnBehalf="0x0000000000000000000000000000000000000000")`
  - `UpgradeScheme`
    - permissions: manage schemes + upgrade controller (`0x0000000A`)
    - voting machine: `AbsoluteVote(votePerc=50,voteOnBehalf="0x0000000000000000000000000000000000000000")`
  - `ContributionReward`
    - orgNativeTokenFee: no fee.
    - permissions: no permissions (`0x00000000`)
    - voting machine: `GenesisProtocol(<details in params.json file>)`

## Develop

1. `git clone https://github.com/daostack/migration.git && cd migration`
2. `npm install`
3. Install [`Docker`](https://docs.docker.com/install/linux/docker-ce/ubuntu/) and
   [`jq`](https://stedolan.github.io/jq/)

### Commands

- `prune-arc-build` - prune unnecessary heavy data from Arc build JSON files.
- `cleandb` - rm the existing local db.
- `ganache` - run a ganache instance with local db.
- `migrate ...` - run migration (same arguments as cli)
- `docker:build` - build the docker image from current directory (make sure all to migrate on a fresh ganache
  beforehand)
- `docker:push` - push docker image to DockerHub.
- `release ...` - fully release a version (requires an `.env` file with `kovan_provider` and `kovan_private_key`
  variables set) (same arguments as cli)

### How to release a version?

In order to release a version:

1. In one terminal tab:

   1. `npm run cleandb` - Clean any existing ganache DB.
   2. `npm run ganache` - Run a ganache, creating a fresh DB.

2. In the another terminal tab:

   1. Make sure you have the required `.env` variables set (`kovan_provider`, `kovan_private_key`, `rinkeby_provider`,
      `rinkeby_private_key`, `mainnet_provider`, `mainnet_private_key`).
   2. Make sure you are not on the `master` branch. If needed, create a new branch for the relase process.
   3. `npm run prepare-release` - This will perform all the nesserary steps to update version and prepare for a new release. The changes made here will be committed to the git branch.
   4. Create a PR and merge the new branch with the changes into `master`.
   5. Make sure that you have a Dockerhub ID with permission to push an image to the `daostack` organization.
   6. Make sure that you have an `npm` account with permission to push an image to the `daostack` organization.
   7. Make sure to be on the `master` branch and run `npm run release` - this will publish the new version to NPM and Dockerhub.
