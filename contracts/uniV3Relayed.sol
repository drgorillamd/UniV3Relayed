//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "hardhat/console.sol";

import "@uniswap/v3-periphery/contracts/interfaces/ISwapRouter.sol";
import "@uniswap/v3-periphery/contracts/interfaces/IQuoter.sol";
import "@uniswap/v3-periphery/contracts/libraries/TransferHelper.sol";
import "./U3RGasTank.sol";

/// @title Uniswap V3 Relayed swaps (U3R)
/// @author DrGorilla.eth
/// @dev implementation of third-party gas sponsoring for Uniswap V3 single input and output (complexes routes are trivial to implement from there)
/// 2 scenarios are treated: swaps from a standard ERC20 token and swap from eth
/// since uniswap handles the weth wrapping, swap from eth is done via the use of an external
/// contract (the GasTank), deployed and owned by the main U3R contract - alternative would be the sender wrapping her ETH to approve/transferFrom,
/// but it would require the sender to spend some gas then).
/// The gas-sponsor party insure user auth via a eth_sign message of a keccak hash of the encodePackaging of nonce+swap params
/// U3R allows user to swap directly (ie without external sponsor for gas), if the swap recipient is the msg.sender
/// Off-chain values (for slippage and quote) are retrieved via a static call to getQuote

contract uniV3Relayed {

    address WETH9 = address(0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2);

    mapping(address=>uint256) public nonces;

    ISwapRouter public immutable swapRouter;
    IQuoter public immutable quoter;
    U3RGasTank public gasTank;

    constructor(address _swapRouter, address _quoter) {
        swapRouter = ISwapRouter(_swapRouter);
        quoter = IQuoter(_quoter);
        gasTank = new U3RGasTank();
    }


    /// @dev perform a swap for an exact amount of tokenOut by interacting with uniswap V3 swapRouter (and gasTank if needed)
    /// user is authenticated by signing a concat of nonce + swap params (since they contain the recipient as well as a deadline)
    /// @param nonce : unique nonce to prevent replay attacks
    /// @param r s v : based on the off-chain signed message / save gas by sending the split version
    /// @param data : the uniswapV3 ISwapRouter.ExactOutputSingleParams parameters
    /// @return amountSpend : the amountIn consumed to swap for amountOut
    function swapExactOutput(uint256 nonce, uint8 v, bytes32 r, bytes32 s, bytes calldata data) external payable returns (uint256 amountSpend) {
        
        ISwapRouter.ExactOutputSingleParams memory params = abi.decode(data, (ISwapRouter.ExactOutputSingleParams));

        require(block.timestamp <= params.deadline, "U3R:deadline expired");

        if(msg.sender != params.recipient) {
            //nonce already consumed ?
            require(nonce == nonces[params.recipient], "U3R:sig:invalid nonce");

            //recreating the message...
            bytes32 digest = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", keccak256(abi.encodePacked(nonce, data))));
            address signer =  ecrecover(digest, v, r, s);
            
            //...to check if the swap recipient is the signer
            require(signer != address(0), "U3R:sig:invalid signature");
            require(params.recipient == signer, "U3R:sig:signer dest mismatch");
            nonces[params.recipient]++;
        }

        //is the tokenIn a standard ERC20 ?
        if(params.tokenIn != WETH9) {
            TransferHelper.safeTransferFrom(params.tokenIn, params.recipient, address(this), params.amountInMaximum); //revert with "STF" string
            TransferHelper.safeApprove(params.tokenIn, address(swapRouter), params.amountInMaximum); //revert with "SA" string
        } else { // == tokenIn is ETH
            // is it a gas-sponsored swap ? is yes, use the gasTank, if no, ETH should have been send, revert if not
            if(msg.sender != params.recipient) {
                require(gasTank.balanceOf(params.recipient) >= params.amountInMaximum, "U3R:0 input left");
                gasTank.use(params.amountInMaximum);
            } else require(msg.value >= params.amountInMaximum, "U3R:0 input left");
        }
        
        try swapRouter.exactOutputSingle{value: address(this).balance}(params) returns(uint256 out) { amountSpend = out;} catch(bytes memory e) { revert(string(e));}

        //is there any left-overs/unswapped eth ? If yes, give them back to the gasTank (if gas-sponsored) or the sender
        if(address(this).balance > 0) {
            if(params.recipient != msg.sender) gasTank.depositFrom{value: address(this).balance}(params.recipient);
            else {
                (bool success, ) = msg.sender.call{value: address(this).balance}(new bytes(0));
                require(success, 'U3R:withdraw error');
            }
        }
    }


    /// @dev perform a swap for an exact amount of tokenIn by interacting with uniswap V3 swapRouter (and gasTank if needed)
    /// user is authenticated by signing a concat of nonce + swap params (since they contain the recipient as well as a deadline)
    /// @param nonce : unique nonce to prevent replay attacks
    /// @param r s v : based on the off-chain signed message / save gas by sending the split version
    /// @param data : the uniswapV3 ISwapRouter.ExactOutputSingleParams parameters
    /// @return amountReceived : the amountOut received
    function swapExactInput(uint256 nonce, uint8 v, bytes32 r, bytes32 s,  bytes calldata data) external payable returns (uint256 amountReceived) {

        ISwapRouter.ExactInputSingleParams memory params = abi.decode(data, (ISwapRouter.ExactInputSingleParams));

        require(block.timestamp <= params.deadline, "U3R: deadline expired");

        if(msg.sender != params.recipient) {
            //nonce already consumed ?
            require(nonce == nonces[params.recipient], "U3R:sig:invalid nonce");

            //recreating the message...
            bytes32 digest = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", keccak256(abi.encodePacked(nonce, data))));
            address signer =  ecrecover(digest, v, r, s);

            //...to check if the swap recipient is the signer
            require(signer != address(0), "U3R:sig:invalid signature");
            require(params.recipient == signer, "U3R:sig:signer dest mismatch");
            nonces[params.recipient]++;
        }

        //is the tokenIn a standard ERC20 ?
        if(params.tokenIn != WETH9) {
            TransferHelper.safeTransferFrom(params.tokenIn, params.recipient, address(this), params.amountIn); //revert with "STF" string
            TransferHelper.safeApprove(params.tokenIn, address(swapRouter), params.amountIn); //revert with "SA" string
        } else { // == tokenIn is ETH
            if(msg.sender != params.recipient) {
                // is it a gas-sponsored swap ? is yes, use the gasTank, if no, ETH should have been send, revert if not
                require(gasTank.balanceOf(params.recipient) >= params.amountIn, "U3R:0 input left");
                gasTank.use(params.amountIn);
            } else require(msg.value >= params.amountIn, "U3R:0 input left");
        }

        try swapRouter.exactInputSingle{value: address(this).balance}(params) returns(uint256 out) { amountReceived = out;} catch(bytes memory e) { revert(string(e));}
    }


    /// @dev DO NOT use in a contract/send a tx to this -> use static calls only (not gas optimized on uniswap end)
    /// either amountIn or amountOut should be 0 and swap direction is then guessed based on it
    function getQuote(address tokenIn, address tokenOut, uint24 fee, uint256 amountIn, uint256 amountOut) external returns (uint256) {
        require( (amountIn == 0 || amountOut == 0) && amountIn != amountOut, "U3R:getQuote: provide one 0 amount"); //solidity logic xor

        if(amountIn > amountOut) return quoter.quoteExactInputSingle(tokenIn, tokenOut, fee, amountIn, 0);
        else return quoter.quoteExactOutputSingle(tokenIn, tokenOut, fee, amountOut, 0);

    }


    receive() external payable {
    }
}
