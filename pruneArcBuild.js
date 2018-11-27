const glob = require("glob");
var fs = require("fs");

const files = glob.sync("./node_modules/@daostack/arc/build/contracts/*.json", {
  nodir: true
});

console.log(`Starts pruning Arc JSON files`);

files.filter(file => {
  const contract = require(`${file}`);
  console.log(`Pruning ${contract.contractName}`);
  var cleanVersion = '{\n "contractName": "';
  cleanVersion += contract.contractName;
  cleanVersion += '",\n "abi": ';
  cleanVersion += JSON.stringify(contract.abi);
  cleanVersion += ',\n "bytecode": "';
  cleanVersion += contract.bytecode;
  cleanVersion += '",\n "deployedBytecode": "';
  cleanVersion += contract.deployedBytecode;
  cleanVersion += '" \n}';
  fs.writeFile(file, cleanVersion, function(err, result) {
    if (err) console.log("error", err);
  });
});

console.log(`Finished pruning Arc JSON files`);
