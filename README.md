-- UNAUDITED and probably optimizable in so many ways - DO NOT USE ON MAINNET --
----------------------------------------------------------------------

## Uniswap V3 gas-sponsored swaps

Tests need to be run on a fork of ethereum mainnet, via :

    npm i
    npx hardhat test
    

## Research question:
How can an user avoid paying for the gas for her swap using uniswap V3

## Summary of the proposed answer:
Alice wants a gas-less swap, Bob owns a third party address
Alice creates a swap payload, including the required parameters from uniswap (based on exactAmountIn or exactAmountOut, https://docs.uniswap.org/protocol/reference/periphery/interfaces/ISwapRouter#parameter-structs) and an unique incremental nonce.
Alice signs a message generated with a keccak256 hash of the packed encoding of her address, her current nonce and the deadline (as a standar uint unix epoch in seconds).
Alice sends this message to Bob, with her swap payload.

Bob verify the authenticity of the message (which needs to have been signed by the swap recipient).
Bob then swap, based on the payload received with the signed message.


## Eth-case
ETH being wrapped by uniswap, U3R is using an external contract, gasTank, to store eth from the users and use them when needed (this is the only part where one user has to pay for gas)


# rem
this can, ofc, have been easily done using openGSN or flashbot sponsored-tx
