#!/bin/bash

set -e
source .env

# npm ci
echo "Installing NPM modules..."
# best to start from sratch or the "verify" script may fail
# rm -r node_modules
# rm package-lock.json
# npm install
npm ci
# initial Arc vrsion to use
readonly INITIAL_VERSION=0
# get latest Arc version
readonly ARC=$(cat package.json | jq -r '.dependencies."@daostack/arc-experimental"' | rev | cut -d'.' -f 1 | rev)
# migrate ganache
for (( version=$INITIAL_VERSION; version<=$ARC; version++ ))
do
if [ "$version" == "5" ]; then
continue
fi
echo "Installing Arc version $version..."
npm install "@daostack/arc-experimental@0.1.2-rc.$version" --save --save-exact
# prune arc build
echo "Pruning Arc build..."
npm run prune-arc-build -- "$@"
# generate abis
echo "Generating abis..."
npm run generate-abis
# migrating Arc version to ganache
echo "Migrating ganache..."
npm run migrate -- --disableconfs --restart --arcversion "0.1.2-rc.$version" "$@"
done
if [ ! -z "$kovan_private_key" ]; then
# migrate kovan
echo "Migrating kovan..."
npm run migrate.base -- --disableconfs --gasPrice 10 --provider $kovan_provider --private-key $kovan_private_key "$@"
fi
if [ ! -z "$rinkeby_private_key" ]; then
# migrate rinkeby
echo "Migrating rinkeby..."
npm run migrate.base -- --disableconfs --gasPrice 10 --provider $rinkeby_provider --private-key $rinkeby_private_key "$@"
fi
if [ ! -z "$mainnet_private_key" ]; then
# migrate mainnet
echo "Migrating mainnet..."
# npm run migrate.base -- --disableconfs --gasPrice 30 --provider $mainnet_provider --private-key $mainnet_private_key "$@"
fi
if [ ! -z "$xdai_private_key" ]; then
# migrate xdai
echo "Migrating xDai..."
npm run migrate.base -- --disableconfs --gasPrice 5 --provider $xdai_provider --private-key $xdai_private_key "$@"
fi
if [ ! -z "$sokol_private_key" ]; then
# migrate sokol
echo "Migrating Sokol..."
# npm run migrate.base -- --disableconfs --gasPrice 5 --provider $sokol_provider --private-key $sokol_private_key "$@"
fi
# set version
echo "Setting version..."
node set-version.js
# update npm package lock
echo "Updating package-lock..."
npm install
echo "Running linter..."
npm run lint-fix
# commit addresses
echo "Commiting changes..."
git add -A && git commit -m "release $(cat package.json | jq -r '.version')"
# push to git
echo "Pushing to github..."
git push -f
# done
echo "Pushed!"

echo "Setting up verifications..."
npm run verify.initialize
npm run verify.build

echo "Verifying..."
read -n 1 -s -r -p "Press any key to verify contracts on rinkeby"
npm run verify -- -n rinkeby -p $rinkeby_provider
read -n 1 -s -r -p "Press any key to verify contracts on kovan"
npm run verify -- -n kovan -p $kovan_provider
read -n 1 -s -r -p "Press any key to verify contracts on xdai"
npm run verify -- -n xdai -p $xdai_provider
read -n 1 -s -r -p "Press any key to verify contracts on mainnet"
npm run verify -- -n mainnet -p $mainnet_provider
