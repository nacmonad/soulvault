import { readFileSync } from 'node:fs';
import { ContractFactory, JsonRpcProvider, Wallet } from 'ethers';

const rpc = process.env.SOULVAULT_ENS_RPC_URL || 'https://ethereum-sepolia-rpc.publicnode.com';
const pk = process.env.SOULVAULT_PRIVATE_KEY;
if (!pk) {
  console.error('SOULVAULT_PRIVATE_KEY is not set. Refusing to deploy without an explicit signer key.');
  process.exit(1);
}
const abiPath = '/tmp/erc8004build/contracts_SoulVaultERC8004RegistryAdapter_sol_SoulVaultERC8004RegistryAdapter.abi';
const binPath = '/tmp/erc8004build/contracts_SoulVaultERC8004RegistryAdapter_sol_SoulVaultERC8004RegistryAdapter.bin';
const abi = JSON.parse(readFileSync(abiPath, 'utf8'));
const bytecode = '0x' + readFileSync(binPath, 'utf8').trim();
const provider = new JsonRpcProvider(rpc, 11155111);
const wallet = new Wallet(pk, provider);
const factory = new ContractFactory(abi, bytecode, wallet);
const contract = await factory.deploy();
await contract.waitForDeployment();
console.log(JSON.stringify({ address: await contract.getAddress(), txHash: contract.deploymentTransaction()?.hash, owner: wallet.address }, null, 2));
