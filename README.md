-- UNAUDITED and probably optimizable in so many ways - DO NOT USE ON MAINNET --
----------------------------------------------------------------------

## Uniswap V3 gas-sponsored swaps

Tests need to be run on a fork of ethereum mainnet, via :

    npm i
    npx hardhat test
    
Mean swap gas consumption: 188k

## Research question:
How can an user avoid paying for the gas for her swap using uniswap V3

## Summary of the proposed answer:
Alice wants a gas-less swap, Bob owns a third party address
Alice creates a swap payload, including the required parameters from uniswap (based on exactAmountIn or exactAmountOut, https://docs.uniswap.org/protocol/reference/periphery/interfaces/ISwapRouter#parameter-structs) and an unique incremental nonce.
Alice signs a message generated with a keccak256 hash of the packed encoding of her current nonce and the swap params.
Alice sends this message to Bob, along with her swap payload.

Bob verify the authenticity of the message (which needs to have been signed by the swap recipient).
Bob then swap, based on the payload received with the signed message.