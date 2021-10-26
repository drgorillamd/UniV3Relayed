//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "hardhat/console.sol";

import "@uniswap/v3-periphery/contracts/interfaces/ISwapRouter.sol";
import "@uniswap/v3-periphery/contracts/interfaces/IQuoter.sol";
import "@uniswap/v3-periphery/contracts/libraries/TransferHelper.sol";
import "./U3RGasTank.sol";

/// @title Uniswap V3 Relayed swaps (U3R)
/// @author DrGorilla.eth
/// @dev implementation of third-party gas sponsoring for Uniswap V3 single input and output
/// 2 scenarios are treated: swaps from a standard ERC20 token and swap from eth
/// since uniswap handles the weth wrapping, swap from eth is done via the use of an external
/// contract (the GasTank), deployed and owned by the main U3R contract.
/// The gas-sponsor party insure user auth via a eth_sign message of a keccak hash of the encodePackaging of swap payload+nonce+deadline
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

    function swapExactOutput(address dest, uint256 nonce, uint256 deadline, uint8 v, bytes32 r, bytes32 s, bytes calldata data) external payable returns (uint256 amountOut) {
        require(block.timestamp <= deadline, "U3R: deadline expired");

        if(msg.sender != dest) {
            require(nonce == nonces[dest], "U3R:sig:invalid nonce");

            bytes32 digest = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", keccak256(abi.encodePacked(dest, nonce, deadline))));
            address signer =  ecrecover(digest, v, r, s);

            require(signer != address(0), "U3R:sig:invalid signature");
            require(dest == signer, "U3R:sig:signer dest mismatch");
            nonces[dest]++;
        }

        amountOut = _swapExactOutput(dest, deadline, data);
    }

    function swapExactInput(address dest, uint256 nonce, uint256 deadline, uint8 v, bytes32 r, bytes32 s, bytes calldata data) external payable returns (uint256 amountOut) {
        require(block.timestamp <= deadline, "U3R: deadline expired");

        if(msg.sender != dest) {
            require(nonce == nonces[dest], "U3R:sig:invalid nonce");

            bytes32 digest = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", keccak256(abi.encodePacked(dest, nonce, deadline))));
            address signer =  ecrecover(digest, v, r, s);

            require(signer != address(0), "U3R:sig:invalid signature");
            require(dest == signer, "U3R:sig:signer dest mismatch");
            nonces[dest]++;
        }

        amountOut = _swapExactInput(dest, deadline, data);
    }

    /// @dev _priceLim is the maximum price impact the swap can have on the pool
    function _swapExactOutput(address dest, uint256 _deadline, bytes calldata data) internal returns (uint256 amountSpend) {

        (address _tokenIn, 
        address _tokenOut, 
        uint24 _fee, 
        uint256 _amountOut,
        uint256 _amountInMaximum,
        uint160 _priceLim) = abi.decode(data, (address, address, uint24, uint256, uint256, uint160));

        if(_tokenIn != WETH9) {
            TransferHelper.safeTransferFrom(_tokenIn, dest, address(this), _amountInMaximum); //revert with "STF" string
            TransferHelper.safeApprove(_tokenIn, address(swapRouter), _amountInMaximum); //revert with "SA" string
        } else {
            // is it a gas-sponsored swap ? is yes, use the gasTank, if no, ETH should have been send
            if(msg.sender != dest) {
                require(gasTank.balanceOf(dest) >= _amountInMaximum, "U3R:0 input left");
                gasTank.use(_amountInMaximum);
            } else require(msg.value >= _amountInMaximum, "U3R:0 input left");
        }

        ISwapRouter.ExactOutputSingleParams memory params = ISwapRouter.ExactOutputSingleParams({
            tokenIn: _tokenIn,
            tokenOut: _tokenOut,
            fee: _fee,
            recipient: dest,
            deadline: _deadline,
            amountOut: _amountOut,
            amountInMaximum: _amountInMaximum,
            sqrtPriceLimitX96: _priceLim
        });
        
        try swapRouter.exactOutputSingle{value: address(this).balance}(params) returns(uint256 out) { amountSpend = out;} catch(bytes memory e) { revert(string(e));}

        //is there any left-overs/unswapped eth ? If yes, give them back to the gasTank (if gas-sponsored) or the sender
        if(address(this).balance > 0) {
            if(dest!=msg.sender) gasTank.depositFrom{value: address(this).balance}(dest);
            else {
                (bool success, ) = msg.sender.call{value: address(this).balance}(new bytes(0));
                require(success, 'U3R:withdraw error');
            }
        }
    }

    function _swapExactInput(address dest, uint256 _deadline, bytes calldata data) internal returns (uint256 amountReceived) {

        (address _tokenIn, 
        address _tokenOut, 
        uint24 _fee, 
        uint256 _amountIn,
        uint256 _amountOutMin,
        uint160 _priceLim) = abi.decode(data, (address, address, uint24, uint256, uint256, uint160));

        if(_tokenIn != WETH9) {
            TransferHelper.safeTransferFrom(_tokenIn, dest, address(this), _amountIn); //revert with "STF" string
            TransferHelper.safeApprove(_tokenIn, address(swapRouter), _amountIn); //revert with "SA" string
        } else {
            if(msg.sender != dest) {
                require(gasTank.balanceOf(dest) >= _amountIn, "U3R:0 input left");
                gasTank.use(_amountIn);
            } else require(msg.value >= _amountIn, "U3R:0 input left");
        }

        ISwapRouter.ExactInputSingleParams memory params = ISwapRouter.ExactInputSingleParams({
            tokenIn: _tokenIn,
            tokenOut: _tokenOut,
            fee: _fee,
            recipient: dest,
            deadline: _deadline,
            amountIn: _amountIn,
            amountOutMinimum: _amountOutMin,
            sqrtPriceLimitX96: _priceLim
        });
        
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
