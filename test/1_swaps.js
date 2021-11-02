const { expect } = require("chai");
const { ethers, waffle } = require("hardhat");

const factory_address = '0x1F98431c8aD98523631AE4a59f267346ea31F984';
const quoter_address = '0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6';

const DAI = '0x6B175474E89094C44Da98b954EedeAC495271d0F';
const WETH9 = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
const USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';

const GWEI = ethers.BigNumber.from(10).pow(18);


//ETH is used as tokenIn scenario and gas is sponsored by another account
describe.only("U3R: ETH->DAI", function () {
  let U3R;
  let owner;
  let user;
  let provider;

  before(async function () {
    const Fact = await ethers.getContractFactory("uniV3Relayed");
    U3R = await Fact.deploy(factory_address, quoter_address);

    const gasFactory = await ethers.getContractFactory("U3RGasTank");
    const gas_address = await U3R.gasTank();
    gasTank = await gasFactory.attach(gas_address);

    provider = waffle.provider;
    [owner] = await ethers.getSigners();


    user = ethers.Wallet.createRandom().connect(provider);
    await owner.sendTransaction({to: user.address, value: GWEI.mul('100')});
    console.log("signer : "+user.address);
  });

  it("Control deployed version: nonce == 0 ?", async function () {
    expect(await U3R.nonces(user.address)).to.equal(0);
  });

  it("Swap ETH for output of 4000DAI via pool 0.3% - gas paid by third-party", async function () {
    const quoteInETH = await U3R.callStatic.getQuote(WETH9, DAI, 3000, 0, GWEI.mul('4000'));
    console.log("quote: 4000 DAI <=> "+(quoteInETH/(10**18))+" ETH");

    // -- payload --
    const quoteWithSlippage = quoteInETH.add(quoteInETH.mul(5).div(100));
    const deadline = Date.now()+60;
    const amountOut = GWEI.mul(4000);
    const dest = user.address;
    const curr_nonce = await U3R.nonces(dest);
    const sqrtPriceLim = 0;
    const fees = 3000;
    const exactIn = false;

    // -- compute pool address --
    const factory = '0x1F98431c8aD98523631AE4a59f267346ea31F984'
    const POOL_INIT_CODE_HASH = '0xe34f199b19b2b4f47f68442619d555527d244f78a3297ea89325f843f87b8b54'
    const key = ethers.utils.keccak256(ethers.utils.defaultAbiCoder.encode([ "address", "address", "uint24"], [DAI, WETH9, fees]));
    const keccak = ethers.utils.solidityKeccak256(["bytes", "address", "bytes", "bytes32"], ["0xff", factory, key, POOL_INIT_CODE_HASH]);
    // keccak is 64 hex digit/nibbles == 32 bytes -> take rightmost 20 bytes=40 nibbles -> start at 64-40=24nibbles or 12 bytes
    const pool = ethers.utils.hexDataSlice(keccak, 12);

/*     struct SwapData {
        uint256 exactInOrOut; //32
        uint256 amountMinOutOrMaxIn; //based on exactIn bool  32
        uint256 deadline;  //32
        uint256 nonce; //32
        address pool; //20
        address tokenIn; //20
        address tokenOut; //20
        address recipient; //20
        uint160 sqrtPriceLimitX96; //5
        uint24 fee; //3
        bool exactIn; //1 -> 89
*/

    const swapParams = ethers.utils.defaultAbiCoder.encode(
    ['uint256' , 'uint256' ,     'uint256' ,  'uint256', 'address', 'address', 'address', 'address',    'uint160', 'uint24', 'bool'],
    [amountOut, quoteWithSlippage, deadline, curr_nonce,      pool,  WETH9   ,  DAI     ,  dest    , sqrtPriceLim,    fees,  exactIn])

    // -- hash and sign --
    const messageHashBytes = ethers.utils.keccak256(swapParams);
    const flatSig = await user.signMessage(ethers.utils.arrayify(messageHashBytes));
    const sig = ethers.utils.splitSignature(flatSig);

    // -- fill gasTank (only for swap FROM eth, since no allowance possible without wrapping) --
    await gasTank.connect(user).deposit({value: quoteWithSlippage});

    // -- gather returned value --
    const eth_swapped = await U3R.connect(owner).callStatic.signedSwap(sig.v, sig.r, sig.s, swapParams);

    // -- actual tx --
    const eth_balance_before = await provider.getBalance(dest);
    const tx = await U3R.connect(owner).signedSwap(sig.v, sig.r, sig.s, swapParams);
    await tx.wait();
    const eth_balance_after = await provider.getBalance(dest);

    expect(eth_swapped).to.be.closeTo(quoteInETH, quoteWithSlippage.sub(quoteInETH)); // = quote was correct, with margin of error = slippage
    expect(eth_balance_after).to.be.equals(eth_balance_before); // = no gas spend
  }) 
});

//DAI (as a random ERC20 token) is used as tokenIn scenario and gas is sponsored by another account
describe("U3R: DAI->USDC", function () {
  let U3R;
  let owner;
  let user;
  let provider;

  before(async function () {
    const Fact = await ethers.getContractFactory("uniV3Relayed");
    U3R = await Fact.deploy(router_address, quoter_address);

    provider = waffle.provider;
    [owner] = await ethers.getSigners();

    user = ethers.Wallet.createRandom().connect(provider);
    await owner.sendTransaction({to: user.address, value: GWEI.mul('100')});
  });


  it("Control deployed version: nonce == 0 ?", async function () {
    expect(await U3R.nonces(user.address)).to.equal(0);
  });


  it("Swap ETH for output of 4000DAI via pool 0.3% - non sponsored / setting the scene", async function () {
    const quoteInETH = await U3R.callStatic.getQuote(WETH9, DAI, 3000, 0, GWEI.mul('4000'));
    console.log("quote: 4000DAI <=> "+(quoteInETH/10**18)+"ETH");

    // -- swap payload --
    const quoteWithSlippage = quoteInETH.add(quoteInETH.mul(5).div(100));
    const fees = 3000;
    const zeroPad32 = ethers.utils.hexZeroPad('0x', 32);
    const amountOut = GWEI.mul('4000');
    const dest = user.address;
    const curr_nonce = await U3R.nonces(dest);
    const deadline = Date.now()+60;

    const swapPayload = ethers.utils.defaultAbiCoder.encode(
      ['address', 'address', 'uint24',  'address', 'uint256', 'uint256',   'uint256',      'uint160'],
      [WETH9,      DAI,       fees,     dest,       deadline,  amountOut,  quoteWithSlippage,      0])

    // -- tx --
    const eth_used = await U3R.connect(user).callStatic.swapExactOutput(curr_nonce, 0, zeroPad32, zeroPad32, swapPayload, {value: quoteWithSlippage});
    const tx = await U3R.connect(user).swapExactOutput(curr_nonce, 0, zeroPad32, zeroPad32, swapPayload, {value: quoteWithSlippage});
    await tx.wait();

    expect(eth_used).to.be.closeTo(quoteInETH, quoteWithSlippage.sub(quoteInETH));
  })

  it("Swap exact DAI (4000) for USDC via pool 0.05% - relayed", async function () {

    const quoteInUSDC = await U3R.callStatic.getQuote(DAI, USDC, 500, GWEI.mul('4000'), 0);
    console.log("quote: 4000 DAI <=> "+quoteInUSDC/(10**6)+" USDC");

    // -- swap payload --
    const minOutInUSDC = quoteInUSDC.sub(quoteInUSDC.mul(5).div(100));
    const fees = 500;
    const deadline = Date.now()+60;
    const amountIn = GWEI.mul('4000');
    const dest = user.address;
    const curr_nonce = await U3R.nonces(dest);

    const swapPayload = ethers.utils.defaultAbiCoder.encode(
      ['address', 'address', 'uint24',  'address', 'uint256', 'uint256',   'uint256',      'uint160'],
      [DAI,        USDC,       fees,     dest,       deadline,  amountIn,    minOutInUSDC,         0])


    // -- hash and sign --
    const messageHashBytes = ethers.utils.solidityKeccak256(['uint256', 'bytes'], [curr_nonce, swapPayload]);
    const flatSig = await user.signMessage(ethers.utils.arrayify(messageHashBytes));
    const sig = ethers.utils.splitSignature(flatSig);


    // -- approve dai spending by U3R contract (router is then approved by U3R) --
    const approve_abi = ["function approve(address spender, uint256 amount) external returns (bool)"];
    const dai_contract = new ethers.Contract(DAI, approve_abi, user);
    const apr_tx = await dai_contract.approve(U3R.address, amountIn);
    await apr_tx.wait();


    // -- returned value --
    const USDC_received = await U3R.connect(owner).callStatic.swapExactInput(curr_nonce, sig.v, sig.r, sig.s, swapPayload);


    // -- actual tx --
    const eth_balance_before = await provider.getBalance(dest);
    const tx = await U3R.connect(owner).swapExactInput(curr_nonce, sig.v, sig.r, sig.s, swapPayload);
    await tx.wait();
    const eth_balance_after = await provider.getBalance(dest);

    expect(USDC_received).to.be.closeTo(quoteInUSDC, quoteInUSDC.sub(minOutInUSDC)); // correct quote
    expect(eth_balance_after).to.be.equals(eth_balance_before); // 0 gas spend
  })
});