async function moveGEN ({ web3, opts, logTx, sendTx, xgenToMove }) {
  let tx

  let weiValue = web3.utils.toWei(xgenToMove.toString())

  let bridgeAddress
  let txMsg

  let network = await web3.eth.net.getNetworkType()
  if (network === 'private') {
    if (await web3.eth.net.getId() === 100) {
      network = 'xdai'
    }
  } else if (network === 'main') {
    network = 'mainnet'
  }

  if (network === 'mainnet') {
    bridgeAddress = '0x6eA6C65E14661C0BcaB5bc862fE5E7D3B5630C2F'
    txMsg = ' GEN tokens to the xDai chain'
  } else if (network === 'xdai') {
    bridgeAddress = '0xe47097ceF3B0bcbb0095A21523714bF0022E2DB8'
    txMsg = ' xGEN tokens to the Ethereum mainnet chain'
  } else {
    console.error('Invalid network specified (please use xDai/ mainnet).')
  }

  let callInterface = {
    'constant': false,
    'inputs': [
      { 'name': '_from', 'type': 'address' },
      { 'name': '_value', 'type': 'uint256' },
      { 'name': '_data', 'type': 'bytes' }
    ],
    'name': 'onTokenTransfer',
    'outputs': [{ 'name': '', 'type': 'bool' }],
    'payable': false,
    'stateMutability': 'nonpayable',
    'type': 'function'
  }

  let callData = web3.eth.abi.encodeFunctionCall(callInterface, [
    web3.eth.defaultAccount,
    weiValue,
    '0x'
  ])

  const GENTokenContract = await new web3.eth.Contract(
    [
      { 'constant': false,
        'inputs': [
          { 'name': '_to', 'type': 'address' },
          { 'name': '_value', 'type': 'uint256' },
          { 'name': '_data', 'type': 'bytes' }
        ],
        'name': 'transfer',
        'outputs': [{ 'name': '', 'type': 'bool' }],
        'payable': false,
        'stateMutability': 'nonpayable',
        'type': 'function' }
    ],
    '0x543Ff227F64Aa17eA132Bf9886cAb5DB55DCAddf',
    opts
  )

  tx = (await sendTx(
    GENTokenContract.methods.transfer(bridgeAddress, weiValue, callData),
    'Moving ' + xgenToMove + txMsg)
  ).receipt
  await logTx(tx, 'Finished moving' + xgenToMove + txMsg)
}

module.exports = moveGEN
