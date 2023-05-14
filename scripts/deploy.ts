import '@nomiclabs/hardhat-ethers';
import { ethers } from 'hardhat';
import { config } from 'dotenv';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { ConduitController, Seaport } from '../typechain-types';

interface ContractInfo {
    marketOwnerAddress: string;
    blockNumber: number;
    conduitControllerContract: string;
    seaportContract: string;
    pausableZoneContract: String;
}

const OUTPUT_DIR = "./output";
const OUTPUT_FILE = `./${OUTPUT_DIR}/seaport-contracts-info.json`;

async function isAlreadyDeployed() {
    try {
        const exists = existsSync(OUTPUT_FILE);
        if (exists) {
            const infoContent = readFileSync(OUTPUT_FILE, { encoding: 'utf8' })
            const info = JSON.parse(infoContent) as ContractInfo;
            const seaportContract = await ethers.getContractFactory("Seaport")
            const contract = await seaportContract.attach(info.seaportContract) as Seaport;
            const name = await contract.name()

            console.log(`already deployed... verified name: ${name}`)
            return true;
        }
        return false;
    } catch (error) {
        return false;
    }
}

async function main() {
    config();

    const deployed = await isAlreadyDeployed()
    if (deployed) {
        return;
    }

    const [marketOwner] = await ethers.getSigners();
    console.log("deploying...");

    // Deploy ConduitController
    const ConduitController = await ethers.getContractFactory("ConduitController");
    const conduitController = await ConduitController.connect(marketOwner).deploy() as ConduitController;
    await conduitController.deployed();
    console.log("conduitController contract address: ", conduitController.address);

    // Deploy Seaport
    const SeaportFactory = await ethers.getContractFactory("Seaport");
    const seaport = await SeaportFactory.connect(marketOwner).deploy(conduitController.address);
    await seaport.deployed();
    console.log("seaport contract address: ", seaport.address);

    const PausableZone = await ethers.getContractFactory("TestZone")
    const pausableZone = await PausableZone.connect(marketOwner).deploy();
    await pausableZone.deployed();
    console.log("pausable Zone contract address: ", pausableZone.address);
    const latestBlock = await ethers.provider.getBlock("latest")

    const info: ContractInfo = {
        marketOwnerAddress: marketOwner.address,
        blockNumber: latestBlock.number,
        conduitControllerContract: conduitController.address,
        seaportContract: seaport.address,
        pausableZoneContract: pausableZone.address,
    };
    const jsonString = JSON.stringify(info, null, 4)

    if (!existsSync(OUTPUT_DIR)) {
        mkdirSync(OUTPUT_DIR);
    }
    writeFileSync(OUTPUT_FILE, jsonString)

}

main().catch(err => {
    console.log("failed to deploy: ", err);
    process.exitCode = 1;
})
