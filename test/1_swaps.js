const { expect } = require("chai");
const { ethers, waffle } = require("hardhat");

const factory_address = '0x1F98431c8aD98523631AE4a59f267346ea31F984';

const DAI = '0x6B175474E89094C44Da98b954EedeAC495271d0F';
const WETH9 = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
const RAI = '0x03ab458634910AaD20eF5f1C8ee96F1D6ac54919';

const GWEI = ethers.BigNumber.from(10).pow(18);

let U3R;
let owner;
let user;
let provider;

before(async function () {
  const Fact = await ethers.getContractFactory("uniV3Relayed");
  U3R = await Fact.deploy(factory_address);

  const gasFactory = await ethers.getContractFactory("U3RGasTank");
  const gas_address = await U3R.gasTank();
  gasTank = await gasFactory.attach(gas_address);

  provider = waffle.provider;
  [owner] = await ethers.getSigners();

  user = ethers.Wallet.createRandom().connect(provider);
  await owner.sendTransaction({to: user.address, value: GWEI.mul('100')});
  console.log("signer : "+user.address);
});

describe("U3R: ETH->DAI", function () {
  it("Control deployed version: nonce == 0 ?", async function () {
    expect(await U3R.nonces(user.address)).to.equal(0);
  });

  it("Swap ETH for output of 4000DAI via pool 0.3%", async function () {
    // -- payload --
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

    // -- retrieve price from slot0 (based on 1.0001^current tick) --
    const slot0abi = ["function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)"];
    const IPool = new ethers.Contract(pool, slot0abi, provider);
    const slot0data = await IPool.slot0();
    const curr_tick = slot0data.tick;
    const quoteInETH = ethers.BigNumber.from(((amountOut * (1.0001**curr_tick))).toString());
    const quoteWithSlippage = quoteInETH.add(quoteInETH.mul(5).div(100));    
    console.log("quote: 4000 DAI <=> "+(quoteInETH/10**18)+" ETH");

    // -- payload abi encoding --
    const swapParams = ethers.utils.defaultAbiCoder.encode(
        ["tuple(uint256, uint256, uint256,  uint256, address,  uint160, bool)"],
        [[amountOut, quoteWithSlippage, deadline, curr_nonce,  pool,    sqrtPriceLim,  exactIn]]);
    const callbackData = ethers.utils.defaultAbiCoder.encode(
        ["tuple(address, address, address, uint24)"],
        [[WETH9,       DAI,      dest,      fees]]);
    const full_payload = ethers.utils.defaultAbiCoder.encode(["bytes", "bytes"], [swapParams, callbackData]);


    // -- hash and sign --
    const messageHashBytes = ethers.utils.keccak256(full_payload);
    const flatSig = await user.signMessage(ethers.utils.arrayify(messageHashBytes));
    const sig = ethers.utils.splitSignature(flatSig);

    // -- fill gasTank (only for swap FROM eth, since no allowance possible without wrapping) --
    await gasTank.connect(user).deposit({value: quoteWithSlippage});

    // -- gather returned value --
    const eth_swapped = await U3R.connect(owner).callStatic.relayedSwap(sig.v, sig.r, sig.s, full_payload);

    // -- actual tx --
    const eth_balance_before = await provider.getBalance(dest);
    const tx = await U3R.connect(owner).relayedSwap(sig.v, sig.r, sig.s, full_payload);
    await tx.wait();
    const eth_balance_after = await provider.getBalance(dest);

    expect(eth_swapped).to.be.closeTo(quoteInETH, quoteWithSlippage.sub(quoteInETH)); // = quote was correct, with margin of error = slippage
    expect(eth_balance_after).to.be.equals(eth_balance_before); // = no gas spend
  }) 
});


describe("U3R: DAI->CRV", function () {

  it("Swap exact DAI (4000) for RAI via pool 0.05%", async function () {

    // -- swap payload --
    const fees = 500;
    const deadline = Date.now()+60;
    const amountIn = GWEI.mul('4000');
    const dest = user.address;
    const curr_nonce = await U3R.nonces(dest);
    const exactIn = true;
    const sqrtPriceLim = 0;

    // -- compute pool address --
    const factory = '0x1F98431c8aD98523631AE4a59f267346ea31F984'
    const POOL_INIT_CODE_HASH = '0xe34f199b19b2b4f47f68442619d555527d244f78a3297ea89325f843f87b8b54'
    const key = ethers.utils.keccak256(ethers.utils.defaultAbiCoder.encode([ "address", "address", "uint24"], [RAI, DAI, fees]));
    const keccak = ethers.utils.solidityKeccak256(["bytes", "address", "bytes", "bytes32"], ["0xff", factory, key, POOL_INIT_CODE_HASH]);
    // keccak is 64 hex digit/nibbles == 32 bytes -> take rightmost 20 bytes=40 nibbles -> start at 64-40=24nibbles or 12 bytes
    const pool = ethers.utils.hexDataSlice(keccak, 12);

    // -- retrieve price from slot0 (based on 1.0001^current tick) --
    const slot0abi = ["function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)"];
    const IPool = new ethers.Contract(pool, slot0abi, provider);
    const slot0data = await IPool.slot0();
    const curr_tick = slot0data.tick;
    //const quoteInRAI = ethers.BigNumber.from( ((amountIn/1.0001**curr_tick)) );
    const quoteInRAI = ethers.BigNumber.from( (amountIn/1.0001**curr_tick).toLocaleString('fullwide', {useGrouping:false}) ); // P=token0/token1 -> RAI per DAI
    console.log("quote: 4000 DAI <=> "+(quoteInRAI/10**18)+" CRV");
    const minOutInRAI = quoteInRAI.sub(quoteInRAI.mul(5).div(100));

    // -- payload abi encoding --
    const swapParams = ethers.utils.defaultAbiCoder.encode(
      ["tuple(uint256, uint256, uint256,  uint256, address,  uint160, bool)"],
      [[amountIn, minOutInRAI, deadline, curr_nonce,  pool,    sqrtPriceLim,  exactIn]]);
    const callbackData = ethers.utils.defaultAbiCoder.encode(
      ["tuple(address, address, address, uint24)"],
      [[DAI,       RAI,      dest,      fees]]);
    const full_payload = ethers.utils.defaultAbiCoder.encode(["bytes", "bytes"], [swapParams, callbackData]);

    // -- hash and sign --
    const messageHashBytes = ethers.utils.keccak256(full_payload);
    const flatSig = await user.signMessage(ethers.utils.arrayify(messageHashBytes));
    const sig = ethers.utils.splitSignature(flatSig);


    // -- approve dai spending by U3R contract --
    const approve_abi = ["function approve(address spender, uint256 amount) external returns (bool)"];
    const dai_contract = new ethers.Contract(DAI, approve_abi, user);
    const apr_tx = await dai_contract.approve(U3R.address, amountIn);
    await apr_tx.wait();

    // -- returned value --
    const RAI_received = await U3R.connect(owner).callStatic.relayedSwap(sig.v, sig.r, sig.s, full_payload);

    // -- actual tx --
    const eth_balance_before = await provider.getBalance(dest);
    const tx = await U3R.connect(owner).relayedSwap(sig.v, sig.r, sig.s, full_payload);
    await tx.wait();
    const eth_balance_after = await provider.getBalance(dest);

    expect(RAI_received).to.be.closeTo(quoteInRAI, quoteInRAI.sub(minOutInRAI)); // correct quote
    expect(eth_balance_after).to.be.equals(eth_balance_before); // 0 gas spend
  })
});