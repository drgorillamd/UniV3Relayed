async function main() {
  const factory_address = '0x1F98431c8aD98523631AE4a59f267346ea31F984';
  const [deployer] = await ethers.getSigners();

  console.log("Deploying contracts with the account:", deployer.address);

  console.log("Account balance:", (await deployer.getBalance()).toString());

  console.log("Chain id:", (await deployer.getChainId()));

  const Contract = await ethers.getContractFactory("uniV3Relayed");
  const contract = await Contract.deploy(factory_address);

  console.log("Contract address:", contract.address);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
