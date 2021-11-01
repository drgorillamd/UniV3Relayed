
const token0 = "0x6B175474E89094C44Da98b954EedeAC495271d0F";
const token1 = "0xDc2b82Bc1106C9c5286e59344896fB0ceb932f53";
const fee = 3000;
const factory = '0x1F98431c8aD98523631AE4a59f267346ea31F984'
const POOL_INIT_CODE_HASH = '0xe34f199b19b2b4f47f68442619d555527d244f78a3297ea89325f843f87b8b54'
const key = ethers.utils.keccak256(ethers.utils.defaultAbiCoder.encode([ "address", "address", "uint24"], [token0, token1, fee]));
const keccack = ethers.utils.solidityKeccak256(["bytes", "address", "bytes", "bytes32"], ["0xff", factory, key, POOL_INIT_CODE_HASH]);
console.log(ethers.utils.hexDataSlice(keccak, 12));

//keccak is 64 hex digit/nibbles == 32 bytes -> take rightmost 20 bytes=40 nibbles -> start at 64-40=24nibbles or 12 bytes
const address = ethers.utils.hexDataSlice(keccak, 12);



//keccak256(abi.encode(foo)):
//ethers.utils.keccak256(ethers.utils.defaultAbiCoder.encode([ "string", "string" ], [ "Hello", "world" ]))

//keccak256(abi.encodePacked(foo)) :
//eth.utils.solidityKeccak256(["string", "string"], ["Hello", "world!"]);

/*
V3-periphery/library/PoolAddress
    const factory = '0x1F98431c8aD98523631AE4a59f267346ea31F984'
    const constant POOL_INIT_CODE_HASH = '0xe34f199b19b2b4f47f68442619d555527d244f78a3297ea89325f843f87b8b54'
    
    
    pool = address(  //bytes20
            uint256( //uint256
                keccak256( //bytes32
                    abi.encodePacked(
                        hex'ff',
                        factory,
                        keccak256(abi.encode(key.token0, key.token1, key.fee)),
                        POOL_INIT_CODE_HASH
                    )
                )
            )
        );
*/