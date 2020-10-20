const commandLineArgs = require('command-line-args');
const commandLineUsage = require('command-line-usage');
const ora = require('ora');
require('dotenv').config();
const axios = require('axios');
const glob = require('glob');
const path = require('path');
import * as truffleFlattener from 'truffle-flattener';
// tslint:disable-next-line: variable-name
const Web3 = require('web3');
const fs = require('fs');
const querystring = require('querystring');
const abi = require('ethereumjs-abi');
import { promisify } from 'es6-promisify';

const sleep = (milliseconds: number): Promise<any> => {
  return new Promise((resolve: () => void): any => setTimeout(resolve, milliseconds));
};

// tslint:disable: max-line-length
const optionDefinitions = [
  { name: 'help', alias: 'h', type: Boolean, description: 'show these command line options' },
  { name: 'version', alias: 'v', type: String, description: 'Optional Arc package version number.  Default is the last version listed in migration.json.' },
  { name: 'contractAddress', alias: 'a', type: String, description: 'Optional address of a single contract to verify, instead of the default.  Must be given with \'contractName\'.' },
  { name: 'contractName', alias: 'c', type: String, description: 'Optional name of a single contract to verify, instead of verifying all of them.' },
  { name: 'network', alias: 'n', type: String, description: 'Required name of the network, such as kovan, rinkeby or mainnet.' },
  { name: 'provider', alias: 'p', type: String, description: 'Required url for web3 network provider (not needed for -g).' },
  { name: 'check', alias: 'g', type: String, description: 'Given verify GUID, check contract verification status.  Ignores other options.' },
  { name: 'outputFlattened', alias: 'f', type: String, description: 'When verifying, absolute path where to save the flattened .sol file to flattened.["contractName"].sol.' },
];
// tslint:enable: max-line-length

const options = commandLineArgs(optionDefinitions);

const usage = (): void => {
  const sections = [
    {
      content: 'Verify migrated Arc contracts to EtherScan.io',
      header: 'Verify Contracts',
    },
    {
      header: 'Options',
      optionList: optionDefinitions,
    },
  ];

  console.log(commandLineUsage(sections));
};

const error = (message: string, showUsage: boolean = false) => {

  console.error(message);
  if (showUsage) {
    usage();
  }
  process.exit(1);
};

if (options.help) {
  usage();
  process.exit(0);
}

if (!options.network) {
  error(`'network' is required.  Run 'npm run help' for cli information.`);
}

if (options.contractAddress && !options.contractName) {
  error(`contractName is required when contractAddress is given. Run 'npm run help' for cli information.`);
}

const APIKEY = process.env.APIKEY;

if (!APIKEY) {
  error(`APIKEY is not found.  See README.md for more information.`);
}

let addresses = {} as any;
let allAddresses = {} as any;
let web3: any;
const migratedContracts = require('./migration.json');

if (!options.check) {

  if (!options.provider) {
    error(`'provider' is required.  Run 'npm run help' for cli information.`);
  }

  /**
   * Enumerate contract names (each with its migrated address) and
   * fetch the .sol file for it.
   */

  options.version = options.version ||
    migratedContracts[options.network] &&
    // tslint:disable-next-line: max-line-length
    (Object.keys(migratedContracts[options.network].package)[Object.keys(migratedContracts[options.network].package).length - 1]);

  allAddresses = (migratedContracts[options.network] &&
    migratedContracts[options.network].package[options.version]) || undefined;

  if (!allAddresses) {
    error(`contracts were not deployed to ${options.network}, or invalid network name`);
  }

  if (options.contractName && options.contractAddress) {
    addresses[options.contractName] = options.contractAddress;
  } else {
    if (options.contractName) {
      if (!allAddresses[options.contractName]) {
        error(
          `contract ${options.contractName} has not been not deployed to ${options.network}, or invalid contract name`);
      }
      addresses[options.contractName] = allAddresses[options.contractName];
    } else {
      addresses = allAddresses;
    }
  }
  web3 = new Web3(options.provider);
}

const processContracts = async (): Promise<any> => {
  let exitCode = 1;
  let anySucceeded = false;
  let spinner: any;

  let url;
  if (options.network === 'xdai') {
    url = 'https://blockscout.com/poa/xdai/api?module=contract&action=verify';
  } else {
    url = `https://api${options.network === 'mainnet' ? '' : ('-' + options.network)}.etherscan.io/api`;
  }

  if (options.check) { // TODO: xdai support
    // check is the GUID
    const result = await validateResult(options.check, url);
    console.log(`Verification status: ${result.result}`);
    exitCode = 0;
  } else {

    console.log(`Verifying contract(s) on ${options.network}, Arc version ${options.version}...`);
    // tslint:disable-next-line: forin
    for (const contractName in addresses) {
      let constructorArguments: string;
      const address = addresses[contractName];

      switch (contractName) {
        case 'GEN':
        case 'DAORegistryInstance':
        case 'DAOFactoryInstance':
        case 'AdminUpgradeabilityProxy':
          // ignore these
          continue;

        case 'Redeemer':
          constructorArguments = await getConstructorParams(address, 128);
          break;
        case 'GenesisProtocol':
        case 'DaoCreator':
        case 'DAORegistry':
          constructorArguments = await getConstructorParams(address, 64);
          break;
      }

      spinner = ora();
      spinner.start(`${contractName} at ${addresses[contractName]}`);

      let foundIn = './node_modules/@daostack/arc-experimental';
      process.chdir(path.join(__dirname, foundIn));

      let solFilePath = glob.sync(`./contracts/**/${contractName}.sol`);
      if (!solFilePath.length) {
        foundIn = './node_modules/@daostack/infra-experimental';
        process.chdir(path.join(__dirname, foundIn));
        solFilePath = glob.sync(`./contracts/**/${contractName}.sol`);
      }

      if (!solFilePath.length) {
        foundIn = './node_modules/@daostack/arc-hive';
        process.chdir(path.join(__dirname, foundIn));
        solFilePath = glob.sync(`./contracts/**/${contractName}.sol`);
      }

      if (!solFilePath.length) {
        foundIn = './node_modules/@daostack/upgrades';
        process.chdir(path.join(__dirname, foundIn));
        solFilePath = glob.sync(`./contracts/**/${contractName}.sol`);
      }

      if (!solFilePath.length) {
        spinner.fail(`contract ${contractName}.sol not found`);
        continue;
      }

      let flattened = await truffleFlattener([solFilePath[0]]);
      flattened = flattened.split('SPDX-License-Identifier').join('');
      if (options.outputFlattened) {
        fs.writeFileSync(path.join(options.outputFlattened, `flattened.${contractName}.sol`), flattened);
      }

      const version = 'v0.6.12+commit.27d51765';
      let apiConfig;
      if (options.network === 'xdai') {
        apiConfig = {
          addressHash: addresses[contractName],
          compilerVersion: version,
          constructorArguements: constructorArguments,
          contractSourceCode: flattened,
          name: contractName,
          optimization: true,
        };
      } else {
        apiConfig = {
          action: 'verifysourcecode',
          apikey: APIKEY,
          compilerVersion: version,
          constructorArguements: constructorArguments,
          // constructorArguements: constructorArguments ? constructorArguments.toString('hex') : '',
          contractaddress: addresses[contractName],
          contractname: contractName,
          module: 'contract',
          optimizationUsed: '1',
          runs: '200',
          sourceCode: flattened,
        };
      }

      try {
        const encodedPostData = querystring.stringify(apiConfig).replace(/%20/g, '+');
        const response = await axios.post(url, encodedPostData,
          {
            headers: {
              'Content-Length': encodedPostData.length,
              'Content-Type': 'application/x-www-form-urlencoded',
            },
          }
        );

        const result = response.data;
        if (options.network === 'xdai') {
          const msg = `${contractName} at ${addresses[contractName]} - ${result.message}`;
          if (result.message.indexOf('Something went wrong') !== -1) {
            spinner.fail(msg);
          } else if (result.message.indexOf('OK') !== -1) {
            spinner.succeed(`${contractName} at ${addresses[contractName]} - contract was verified successfully.`);
          } else {
            spinner.info(msg);
          }
        } else {
          if (result.status === '1') {
            // 1 = submission success, use the guid returned (result.result) to check the status of the submission.
            anySucceeded = true;
            const verifyResult = await validateResult(result.result, url);
            if (verifyResult.result !== 'Pending in queue') {
              spinner.fail(
                `${contractName} at ${addresses[contractName]} ${verifyResult.result}, GUID: ${result.result}`);
            } else {
              spinner.succeed(
                `${contractName} at ${addresses[contractName]} ${verifyResult.result}, GUID: ${result.result}`);
            }
          } else {
            if (result.result.indexOf('already verified') !== -1) {
              spinner.info(`${contractName} at ${addresses[contractName]} ${result.result}`);
            } else {
              spinner.fail(`${contractName} at ${addresses[contractName]} ${result.result}`);
            }
          }
        }
        await sleep(500);
        exitCode = 0;
      } catch (ex) {
        if (spinner) {
          spinner.fail();
        }
        console.error(ex.message);
      }
    }

    if (anySucceeded && options.network !== 'xdai') {
      // tslint:disable-next-line: max-line-length
      console.log(`In-queue validation(s) may or may succeed.  To confirm, use -g option with GUID or check on https://${options.network === 'mainnet' ? '' : (options.network + '.')}etherscan.io/contractsVerified`);
    }
  }
  process.exit(exitCode);
};

/**
 * Given a GUID, confirms whether the validation really did succeed
 * @param guid
 * @param url
 */
// TODO: Add xdai support
const validateResult = async (guid: string, url: string): Promise<any> => {
  const response = await axios.get(url,
    {
      params:
        { module: 'contract', action: 'checkverifystatus', guid },
    });

  return response.data;
};

// const contructorParamsPrefix = 'a165627a7a72305820';

const getConstructorParams = async (address: string, bytes: number): Promise<string> => {
  const code = await promisify((callback: any): any =>
    web3.eth.getCode(address, callback))() as string;
  return code.substr(code.length - bytes);
};

processContracts();
