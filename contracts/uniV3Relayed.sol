//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;
pragma experimental ABIEncoderV2;

import "hardhat/console.sol";

import "@uniswap/v3-core/contracts/interfaces/IUniswapV3Pool.sol";
import "@uniswap/v3-core/contracts/interfaces/IUniswapV3Factory.sol";
import "@uniswap/v3-periphery/contracts/libraries/TransferHelper.sol";
import "./U3RGasTank.sol";

interface IWeth {
    function deposit() external payable;
    function transfer(address recipient, uint amount) external;
    function withdraw(uint256) external;
}

/// @title Uniswap V3 Relayed swaps (U3R)
/// @author DrGorilla.eth
/// @dev implementation of third-party gas sponsoring for Uniswap V3 single input and output
/// 2 scenarios are treated: swaps from a standard ERC20 token and swap from eth
/// since uniswap handles the weth wrapping, swap from eth is done via the use of an external
/// contract (the GasTank), deployed and owned by the main U3R contract - alternative would be the sender wrapping her ETH to approve/transferFrom,
/// but it would require the sender to spend some gas then).
/// The gas-sponsor party insure user auth via a eth_sign message of a keccak hash of the encodePackaging of nonce+swap params
/// U3R allows user to swap directly (ie without external sponsor for gas), if the swap recipient is the msg.sender
/// Off-chain values (for slippage and quote) are retrieved via a static call to getQuote

contract uniV3Relayed {

    /// @dev The minimum value that can be returned from #getSqrtRatioAtTick. Equivalent to getSqrtRatioAtTick(MIN_TICK)
    uint160 internal constant MIN_SQRT_RATIO = 4295128739;

    /// @dev The maximum value that can be returned from #getSqrtRatioAtTick. Equivalent to getSqrtRatioAtTick(MAX_TICK)
    uint160 internal constant MAX_SQRT_RATIO = 1461446703485210103287273052203988822378723970342;

    address WETH9_ADR = address(0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2);
    IWeth IWETH9 = IWeth(WETH9_ADR);

    mapping(address=>uint256) public nonces;

    IUniswapV3Factory public immutable swapFactory;
    U3RGasTank public immutable gasTank;

    constructor(address _uniFactory) {
        swapFactory = IUniswapV3Factory(_uniFactory);
        gasTank = new U3RGasTank();
    }

    struct SwapData {
        uint256 exactInOrOut; //32
        uint256 amountMinOutOrMaxIn; //based on exactIn bool  32
        uint256 deadline;  //32
        uint256 nonce; //32
        address pool; //20
        uint160 sqrtPriceLimitX96; //5
        bool exactIn; //1 -> 89
    }

    struct SwapCallbackData {
        address tokenIn; //20
        address tokenOut; //20
        address recipient; //20
        uint24 fee; //3
    }

    /// @dev performs the authenticated swap, gas being paid by the executer.
    /// Recipient needs to encode and pass SwapData and SwapCallbackData as well as the signed _data, 
    /// a third party can then execute it.
    /// @param v + r + s : _data signed by the swap recipients (the same as in callbackData.recipient)
    /// @param _data : abi.encode( SwapData, SwapCallbackData)
    function relayedSwap(uint8 v, bytes32 r, bytes32 s, bytes memory _data) external payable returns (uint256 amount) {

        (bytes memory a, bytes memory b) = abi.decode(_data, (bytes, bytes));

        //(SwapData memory params) = abi.decode(a, (SwapData));  -> 200 to 171k mean cost
        SwapData memory params;
        assembly {
            if lt(eq(calldatasize(), 0x284), 1) { revert(0,0) }  //is _data bigger / trying to overwrite?
            params := add(mload(mload(a)), 0x20)
        }

        //(SwapCallbackData memory callbackData) = abi.decode(b, (SwapCallbackData));
        SwapCallbackData memory callbackData;
        assembly {
            callbackData := add(mload(mload(b)), 0x20)
        }

        require(params.exactInOrOut < 2**255, "U3R:int256 overflow");
        require(block.timestamp <= params.deadline, "U3R:deadline expired");

        int256 exactInOrOut = int256(params.exactInOrOut);
        bool zeroForOne = callbackData.tokenIn < callbackData.tokenOut;

        //nonce already consumed ?
        require(params.nonce == nonces[callbackData.recipient], "U3R:sig:invalid nonce");

        //recreating the message...
        bytes32 digest = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", keccak256(_data)));
        address signer =  ecrecover(digest, v, r, s);
        
        //...to check if the swap recipient is the signer
        require(signer != address(0), "U3R:sig:invalid signature");
        require(callbackData.recipient == signer, "U3R:sig:signer dest mismatch");
        nonces[callbackData.recipient]++;


        try IUniswapV3Pool(params.pool).swap(
            address(this), 
            zeroForOne,
            params.exactIn ? exactInOrOut : -exactInOrOut,  //exactIn-> int256(amountIn); exactOut-> -amountOut.toInt256(),
            params.sqrtPriceLimitX96 == 0 ? (zeroForOne ? MIN_SQRT_RATIO + 1 : MAX_SQRT_RATIO - 1) : params.sqrtPriceLimitX96, 
            abi.encode(callbackData)
        ) returns (int256 amount0, int256 amount1) {

            //what swap was it (exactIn or Out) ? adapt returned value accordingly
            if(params.exactIn) amount = zeroForOne ? uint256(-amount1) : uint256(-amount0);
            else amount = zeroForOne ? (uint256(amount0)) : (uint256(amount1));

            // max slippage ?
            if(params.exactIn) require(amount >= params.amountMinOutOrMaxIn, "U3R:max slippage");
            else require(amount <= params.amountMinOutOrMaxIn, "U3R:max slippage");

            //send what we received to the recipient:
            // 1) what did we receive?
            (, bytes memory data) = callbackData.tokenOut.staticcall(abi.encodeWithSignature("balanceOf(address)", address(this)));
            uint256 received;
            assembly {
                received := mload(add(data, 0x20))
            }
            //TODO: compare gas cost of this staticcall to recomparing what's in/out and was it exactIn/Out?
            //2) send it
            if(callbackData.tokenOut == WETH9_ADR) {
                IWETH9.withdraw(received);
                //swap already paid during callback at this point+nonce consumed, no reentrancy:
                (bool success, ) = callbackData.recipient.call{value: received}(new bytes(0));
                require(success, 'U3R:withdraw error');
            }
            else TransferHelper.safeTransferFrom(callbackData.tokenOut, address(this), callbackData.recipient, received); 

            //is there any left-overs/unswapped eth ? If yes, give them back to the gasTank (if gas-sponsored) or the sender
            if(address(this).balance > 0) {
                if(callbackData.recipient != msg.sender) gasTank.depositFrom{value: address(this).balance}(callbackData.recipient);
                else {
                    (bool success, ) = msg.sender.call{value: address(this).balance}(new bytes(0));
                    require(success, 'U3R:withdraw error');
                }
            }

        } catch (bytes memory e) { revert(string(e)); }
    }


    /// @dev 2 things needs to be done in the callback : pay the pool for the swap and check it's a legit pool calling it
    // (ie deployed by the Uni V3 Factory) -> deterministic pool address is already computed offchain and passed in data
    // but relying on it would allow an user to pass an arbitrary contract as pool in his signed message then call callback
    // -> new check in callback
    function uniswapV3SwapCallback(
        int256 amount0Delta,
        int256 amount1Delta,
        bytes calldata _data
    ) external {
        require(amount0Delta > 0 || amount1Delta > 0, "U3R:0 liquidity area swap");

        SwapCallbackData memory data = abi.decode(_data, (SwapCallbackData));

        require(msgSenderIsPool(data.tokenIn, data.tokenOut, data.fee), "Invalid pool");

        (bool isExactInput, uint256 amountToPay) =
            amount0Delta > 0
                ? (data.tokenIn < data.tokenOut, uint256(amount0Delta))
                : (data.tokenOut < data.tokenIn, uint256(amount1Delta));

        if (isExactInput) { 
            pay(data.tokenIn, data.recipient, msg.sender, amountToPay);

        } else { //only mono-pool swaps
            // swap in/out because exact output swaps are reversed
            pay(data.tokenOut, data.recipient, msg.sender, amountToPay);
        }
    }

    function pay(address tokenIn, address payer, address pool, uint256 amount) internal {

        //is the tokenIn a standard ERC20 ?
        if(tokenIn != WETH9_ADR) {
            TransferHelper.safeTransferFrom(tokenIn, payer, pool, amount); //revert with "STF" string

        } else { // == tokenIn is ETH
            require(gasTank.balanceOf(payer) >= amount, "U3R:0 input left");
            gasTank.use(payer, amount);
            IWETH9.deposit{value: amount}();
            IWETH9.transfer(pool, amount);
        }
    }

    function msgSenderIsPool(address token0, address token1, uint24 fee) internal view returns (bool) {
        //address factory = '0x1F98431c8aD98523631AE4a59f267346ea31F984';
        bytes32 POOL_INIT_CODE_HASH = 0xe34f199b19b2b4f47f68442619d555527d244f78a3297ea89325f843f87b8b54;
    
        if(token0>token1) (token0, token1) = (token1, token0); //tokenIn and Out are passed as params, insure order
        bytes32 pubKey = keccak256(abi.encodePacked(hex'ff', address(swapFactory), keccak256(abi.encode(token0, token1, fee)), POOL_INIT_CODE_HASH));
        address theo_adr;

        //bytes32 to address:
        assembly {
            mstore(0x0, pubKey)
            theo_adr := mload(0x0)
        }

        return msg.sender == theo_adr;
    }

    receive() external payable {
    }
}
