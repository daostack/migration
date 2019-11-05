async function allocateRep ({ web3, spinner, opts, migrationParams, logTx }) {
  let nonce = await web3.eth.getTransactionCount(web3.eth.defaultAccount) - 1

  spinner.start('Allocating Reputation...')

  const [founderAddresses, repDist] = [
    migrationParams.founders.map(({ address }) => address),
    migrationParams.founders.map(({ reputation }) => web3.utils.toWei(reputation !== undefined ? reputation.toString() : '0'))
  ]

  const repAllocation = new web3.eth.Contract(
    require('@daostack/arc/build/contracts/RepAllocation.json').abi,
    migrationParams.repAllocationContractAddress,
    opts
  )

  const allocateRep = repAllocation.methods.addBeneficiaries(founderAddresses, repDist)

  let tx = await allocateRep.send({ nonce: ++nonce })

  await logTx(tx, 'Allocated Reputation Successfully.')
}

module.exports = allocateRep
