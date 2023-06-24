import { BigNumber, Contract, utils } from "ethers";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import type { NFTTestERC721, TestERC20 } from "../typechain-types";
import { expect } from "chai";
import { Seaport } from "@opensea/seaport-js";
import { providers } from "@0xsequence/multicall";
import { ItemType, MAX_INT, OrderType } from "@opensea/seaport-js/lib/constants";
import { randomHex } from "./utils/encoding";
import { ConsiderationItem } from "./utils/types";
import { ConsiderationInputItem, MatchOrdersFulfillment, Order, OrderWithCounter } from "@opensea/seaport-js/lib/types";
import { generateRandomSalt } from "@opensea/seaport-js/lib/utils/order";
import { isCurrencyItem } from "@opensea/seaport-js/lib/utils/item";
import { parseEther } from "ethers/lib/utils";

describe("Sale", () => {
  let marketOwner: SignerWithAddress;
  let seller: SignerWithAddress;
  let buyer: SignerWithAddress;
  let attacker: SignerWithAddress;
  let conduitController: Contract;
  let seaport: Contract;
  let testERC721: NFTTestERC721;
  let testErc20: TestERC20;
  let pausableZone: Contract;
  let multicallProvider: providers.MulticallProvider;
  let seaportJS: Seaport;
  let seaportJS2: Seaport;

  beforeEach(async () => {
    [marketOwner, seller, buyer, attacker] = await ethers.getSigners();

    const ConduitController = await ethers.getContractFactory("ConduitController");
    conduitController = await ConduitController.connect(marketOwner).deploy();
    await conduitController.deployed();
    console.log("conduitController contract address: ", conduitController.address);


    const SeaportFactory = await ethers.getContractFactory("Seaport");
    seaport = await SeaportFactory.connect(marketOwner).deploy(conduitController.address);
    await seaport.deployed();
    console.log("seaport contract address: ", seaport.address);


    const NFTTestERC721Factory = await ethers.getContractFactory("NFTTestERC721");
    testERC721 = await NFTTestERC721Factory.connect(marketOwner).deploy();
    await testERC721.deployed();
    console.log("NFT contract address: ", testERC721.address);

    const PausableZone = await ethers.getContractFactory("TestTransferValidationZoneOfferer")
    pausableZone = await PausableZone.deploy(ethers.constants.AddressZero);
    await pausableZone.deployed();
    console.log("pausable Zone contract address: ", pausableZone.address);

    await testERC721.connect(marketOwner).mint(marketOwner.address, 1)
    await testERC721.connect(marketOwner).transferFrom(marketOwner.address, seller.address, 1)


    const TestERC20 = await ethers.getContractFactory("TestERC20");
    testErc20 = await TestERC20.connect(marketOwner).deploy();
    await testErc20.deployed();

    await testErc20.connect(marketOwner).mint(buyer.address, parseEther('2000'));
    await testErc20.connect(buyer).approve(seaport.address, parseEther('20'));

    multicallProvider = new providers.MulticallProvider(ethers.provider);

    seaportJS = new Seaport(seller, {
      balanceAndApprovalChecksOnOrderCreation: true,
      overrides: {
        contractAddress: seaport.address,
      }
    });

    seaportJS2 = new Seaport(buyer, {
      balanceAndApprovalChecksOnOrderCreation: true,
      overrides: {
        contractAddress: seaport.address
      }
    });
  });

  it("basic order", async () => {

    const { executeAllActions } = await seaportJS.createOrder(
      {
        offer: [
          {
            itemType: 2,
            token: testERC721.address,
            identifier: "1",
          },
        ],
        consideration: [
          {
            amount: ethers.utils.parseEther("1").toString(),
            recipient: seller.address,
          },
        ],

      },
      seller.address
    );
    const order = await executeAllActions();

    const results = await seaportJS2.fulfillOrder({
      order,
      accountAddress: buyer.address,
    });

    const transaction = await results.executeAllActions();
    const data = await transaction.wait()
    expect(data.blockNumber).be.gt(0)
    console.log("successfully purchased NFT", data.blockNumber)
  })

  it.only("basic offer order", async () => {
    const startTime = await (
      await ethers.provider.getBlock("latest")
    ).timestamp.toString();
    const SECONDS_IN_WEEK = 604800;
    const endTime = BigNumber.from(startTime).add(SECONDS_IN_WEEK).toString();

    const { actions, executeAllActions } = await seaportJS2.createOrder(
      {
        offer: [
          {
            amount: ethers.utils.parseEther("1").toString(),
            // token: testErc20.address
          },
        ],
        consideration: [
          {
            itemType: 2,
            token: testERC721.address,
            identifier: "1",
            recipient: buyer.address,
          },
        ],
        fees: [{ recipient: marketOwner.address, basisPoints: 250 }],
        startTime,
        endTime
      },
      buyer.address
    );

    // expect(actions.length).to.be.equal(2)
    const order = await executeAllActions();

    // const valid = await seaportJS2.validate([order]);
    // const transact =  await valid.transact()
    // const recept =  await transact.wait()

    const results = await seaportJS.fulfillOrder({
      order,
      accountAddress: seller.address,
    });

    expect(results.actions.length).to.be.equal(2)

    const transaction = await results.executeAllActions();
    const data = await transaction.wait()
    expect(data.blockNumber).be.gt(0)
    console.log("successfully purchased NFT", data.blockNumber)
  })

  it("basic order and validate", async () => {

    const { executeAllActions } = await seaportJS.createOrder(
      {
        offer: [
          {
            itemType: 2,
            token: testERC721.address,
            identifier: "1",
          },
        ],
        consideration: [
          {
            amount: ethers.utils.parseEther("1").toString(),
            recipient: seller.address,
          },
        ],
      },
      seller.address
    );
    const order = await executeAllActions();
    const valid = await seaportJS.validate([order])
    const transact = await valid.transact()
    const recept = await transact.wait()
    expect(recept.blockNumber).not.undefined
  })

  it("basic order with processing fee to a account", async () => {

    const endTime = MAX_INT.toString();
    const { executeAllActions } = await seaportJS.createOrder(
      {
        startTime: "0",
        endTime,
        offer: [
          {
            itemType: 2,
            token: testERC721.address,
            identifier: "1",
          },
        ],
        consideration: [
          {
            amount: ethers.utils.parseEther("1").toString(),
            recipient: seller.address,
          },
        ],
        ////// change
        fees: [{ recipient: marketOwner.address, basisPoints: 250 }],
        //////
      },
      seller.address
    );
    const order = await executeAllActions();

    const results = await seaportJS2.fulfillOrder({
      order,
      accountAddress: buyer.address,
    });

    const transaction = await results.executeAllActions();
    const data = await transaction.wait()
    expect(data.blockNumber).be.gt(0)
    console.log("successfully purchased NFT", data.blockNumber)
  })

  it("basic order with processing fee and zone", async () => {

    const endTime = MAX_INT.toString();
    const { executeAllActions } = await seaportJS.createOrder(
      {
        startTime: "0",
        endTime,
        offer: [
          {
            itemType: 2,
            token: testERC721.address,
            identifier: "1",
          },
        ],
        consideration: [
          {
            amount: ethers.utils.parseEther("1").toString(),
            recipient: seller.address,
          },
        ],
        //// change
        fees: [{ recipient: pausableZone.address, basisPoints: 250 }],
        restrictedByZone: true,
        zone: pausableZone.address
        ////
      },
      seller.address
    );
    const order = await executeAllActions();

    const results = await seaportJS2.fulfillOrder({
      order,
      accountAddress: buyer.address,
    });

    const transaction = await results.executeAllActions();
    const data = await transaction.wait()
    expect(data.blockNumber).be.gt(0)
    console.log("successfully purchased NFT", data.blockNumber)
  })

  it("expired for auction order with processing fee and zone", async () => {
    //// change
    const endTime = (Math.floor(new Date().getTime() / 1000) - 30).toString();
    ////
    const { executeAllActions } = await seaportJS.createOrder(
      {
        startTime: "0",
        endTime,
        offer: [
          {
            itemType: 2,
            token: testERC721.address,
            identifier: "1",
          },
        ],
        consideration: [
          {
            amount: ethers.utils.parseEther("1").toString(),
            recipient: seller.address,
          },
        ],
        fees: [{ recipient: pausableZone.address, basisPoints: 250 }],
        restrictedByZone: true,
        zone: pausableZone.address,
      },
      seller.address
    );
    const order = await executeAllActions();

    const results = await seaportJS2.fulfillOrder({
      order,
      accountAddress: buyer.address,
    });

    await expect(
      results.executeAllActions()
    )
      .to.be.revertedWithCustomError(seaport, "InvalidTime")
      .withArgs('0', endTime);
  })

  it("Ascending dutch auction", async () => {

    const startTime = await (
      await ethers.provider.getBlock("latest")
    ).timestamp.toString();
    // Ends one week from the start date
    const SECONDS_IN_WEEK = 604800;
    const endTime = BigNumber.from(startTime).add(SECONDS_IN_WEEK).toString();

    const { executeAllActions } = await seaportJS.createOrder(
      {
        startTime,
        endTime,
        offer: [
          {
            itemType: 2,
            token: testERC721.address,
            identifier: "1",
          },
        ],
        consideration: [
          {
            amount: ethers.utils.parseEther("1").toString(),
            endAmount: ethers.utils.parseEther("100").toString(),

            recipient: seller.address,
          },
        ],

        fees: [{ recipient: pausableZone.address, basisPoints: 250 }],
        restrictedByZone: true,
        zone: pausableZone.address,
      },
      seller.address
    );
    const order = await executeAllActions();

    // time travel
    const balanceBefore = await buyer.getBalance();
    const nextBlockTimestamp = BigNumber.from(startTime)
      .add(endTime)
      .div(2)
      .toNumber();

    // Set the next block to be the halfway point between startTime and endTime
    await ethers.provider.send("evm_setNextBlockTimestamp", [
      nextBlockTimestamp,
    ]);
    await ethers.provider.send("evm_mine", []);



    // buy
    const results = await seaportJS2.fulfillOrder({
      order,
      accountAddress: buyer.address,
    });

    const transaction = await results.executeAllActions();
    const data = await transaction.wait()
    expect(data.blockNumber).be.gt(0)
    console.log("successfully purchased NFT", data.blockNumber)

    const balanceAfter = await buyer.getBalance();
    const balanceAfterEth = ethers.utils.formatEther(balanceAfter)

    expect(balanceAfter).lt(balanceBefore)
    expect(parseFloat(balanceAfterEth)).lt(9952)
  })

  it("Descending dutch auction", async () => {

    const startTime = await (
      await ethers.provider.getBlock("latest")
    ).timestamp.toString();
    // Ends one week from the start date
    const SECONDS_IN_WEEK = 604800;
    const endTime = BigNumber.from(startTime).add(SECONDS_IN_WEEK).toString();

    const { executeAllActions } = await seaportJS.createOrder(
      {
        startTime,
        endTime,
        offer: [
          {
            itemType: 2,
            token: testERC721.address,
            identifier: "1",
          },
        ],
        consideration: [
          {
            amount: ethers.utils.parseEther("100").toString(),
            endAmount: ethers.utils.parseEther("1").toString(),

            recipient: seller.address,
          },
        ],

        fees: [{ recipient: pausableZone.address, basisPoints: 250 }],
        restrictedByZone: true,
        zone: pausableZone.address,
      },
      seller.address
    );
    const order = await executeAllActions();

    // time travel
    const balanceBefore = await buyer.getBalance();
    const SECONDS_IN_TWO_DAYS = 86400 * 2;
    const nextBlockTimestamp = BigNumber.from(startTime).add(SECONDS_IN_TWO_DAYS).toNumber();

    // Set the next block to be the halfway point between startTime and endTime
    await ethers.provider.send("evm_setNextBlockTimestamp", [
      nextBlockTimestamp,
    ]);
    await ethers.provider.send("evm_mine", []);



    // buy
    const results = await seaportJS2.fulfillOrder({
      order,
      accountAddress: buyer.address,
    });

    const transaction = await results.executeAllActions();
    const data = await transaction.wait()
    expect(data.blockNumber).be.gt(0)
    console.log("successfully purchased NFT", data.blockNumber)

    const balanceAfter = await buyer.getBalance();
    const balanceAfterEth = ethers.utils.formatEther(balanceAfter)

    expect(balanceAfter).lt(balanceBefore)
    expect(parseFloat(balanceAfterEth)).lt(9930)
  })


  it("sell it to particular user", async () => {
    const { executeAllActions } = await seaportJS.createOrder(
      {
        startTime: "0",
        offer: [
          {
            itemType: ItemType.ERC721,
            token: testERC721.address,
            identifier: '1',
          },
        ],
        consideration: [
          {
            amount: ethers.utils.parseEther("10").toString(),
            recipient: seller.address,
          },
          {
            itemType: ItemType.ERC721,
            token: testERC721.address,
            identifier: '1',
            recipient: buyer.address,
          },
        ],
        // 2.5% fee
        fees: [{ recipient: marketOwner.address, basisPoints: 250 }],
      },
      seller.address
    );
    const order = await executeAllActions();

    // const counterOrder: Order = {
    //   parameters: {
    //     ...order.parameters,
    //     offerer: buyer.address,
    //     offer: [
    //       {
    //         itemType: ItemType.ERC721,
    //         token: '0x0000000000000000000000000000000000000000',
    //         identifierOrCriteria: '0',
    //         startAmount: ethers.utils.parseEther("10").toString(),
    //         endAmount: ethers.utils.parseEther("10").toString(),
    //       },
    //     ],
    //     // The consideration here is empty as the original private listing order supplies
    //     // the taker address to receive the desired items.
    //     consideration: [],
    //     salt: generateRandomSalt(),
    //     totalOriginalConsiderationItems: 0,
    //   },
    //   signature: "0x",
    // };

    // const fulfillments: MatchOrdersFulfillment[] = [];

    const counterOrder = constructPrivateListingCounterOrder(
      order,
      buyer.address
    );
    const fulfillments = getPrivateListingFulfillments(order);

    // match order and perform transaction
    const transaction = await seaportJS2
      .matchOrders({
        orders: [order, counterOrder],
        fulfillments,
        overrides: {
          value: counterOrder.parameters.offer[0].startAmount,
        }
      })
      .transact();
    const data = await transaction.wait()
    expect(data.blockNumber).be.gt(0)

    // balance is updated
    const balanceAfter = await buyer.getBalance();
    const balanceAfterEth = ethers.utils.formatEther(balanceAfter)
    expect(parseFloat(balanceAfterEth)).lt(9990)
    console.log("successfully purchased NFT", data.blockNumber)

    const nftOnwer = await testERC721.connect(buyer).ownerOf('1')
    expect(nftOnwer).equal(buyer.address)
  })

  it.skip("transfer token though conduit controller", async () => {

    // const conduitKeyOne = `${bob.address}00000 00000 00 00000 00000 00`;
    // const assignedConduitKey = bob.address + randomHex(12).slice(2);
    const assignedConduitKey = `${marketOwner.address}000000000000000000000000`;

    const { conduit: tempConduitAddress } = await conduitController.connect(marketOwner).getConduit(
      assignedConduitKey
    );
    await testERC721.connect(marketOwner).setApprovalForAll(tempConduitAddress, true)

    seaportJS = new Seaport(seller, {
      balanceAndApprovalChecksOnOrderCreation: true,
      conduitKeyToConduit: { [assignedConduitKey]: tempConduitAddress },
      overrides: {
        contractAddress: seaport.address,
        defaultConduitKey: assignedConduitKey,
      }
    });



    const { executeAllActions } = await seaportJS.createOrder(
      {
        offer: [
          {
            itemType: 2,
            token: testERC721.address,
            identifier: "1",
          },
        ],
        consideration: [
          {
            amount: ethers.utils.parseEther("1").toString(),
            recipient: seller.address,
          },
        ],
        fees: [{ recipient: pausableZone.address, basisPoints: 250 }],
        conduitKey: assignedConduitKey,
        // useProxy: true
      },
      seller.address

    );
    const order = await executeAllActions();



    seaportJS2 = new Seaport(seller, {
      balanceAndApprovalChecksOnOrderCreation: true,
      conduitKeyToConduit: { [assignedConduitKey]: tempConduitAddress },
      overrides: {
        contractAddress: seaport.address,
        defaultConduitKey: assignedConduitKey,
      }
    });

    const results = await seaportJS2.fulfillOrder({
      order,
      accountAddress: buyer.address,
      conduitKey: assignedConduitKey,
    });

    const transaction = await results.executeAllActions();
    const data = await transaction.wait()
    expect(data.blockNumber).be.gt(0)
    console.log("successfully purchased NFT", data.blockNumber)

  })

});


export const constructPrivateListingCounterOrder = (
  order: OrderWithCounter,
  privateSaleRecipient: string
): Order => {
  // Counter order offers up all the items in the private listing consideration
  // besides the items that are going to the private listing recipient
  const paymentItems = order.parameters.consideration.filter(
    (item) =>
      item.recipient.toLowerCase() !== privateSaleRecipient.toLowerCase()
  );

  if (!paymentItems.every((item) => isCurrencyItem(item))) {
    throw new Error(
      "The consideration for the private listing did not contain only currency items"
    );
  }
  if (
    !paymentItems.every((item) => item.itemType === paymentItems[0].itemType)
  ) {
    throw new Error("Not all currency items were the same for private order");
  }

  const { aggregatedStartAmount, aggregatedEndAmount } = paymentItems.reduce(
    ({ aggregatedStartAmount, aggregatedEndAmount }, item) => ({
      aggregatedStartAmount: aggregatedStartAmount.add(item.startAmount),
      aggregatedEndAmount: aggregatedEndAmount.add(item.endAmount),
    }),
    {
      aggregatedStartAmount: BigNumber.from(0),
      aggregatedEndAmount: BigNumber.from(0),
    }
  );

  const counterOrder: Order = {
    parameters: {
      ...order.parameters,
      offerer: privateSaleRecipient,
      offer: [
        {
          itemType: paymentItems[0].itemType,
          token: paymentItems[0].token,
          identifierOrCriteria: paymentItems[0].identifierOrCriteria,
          startAmount: aggregatedStartAmount.toString(),
          endAmount: aggregatedEndAmount.toString(),
        },
      ],
      // The consideration here is empty as the original private listing order supplies
      // the taker address to receive the desired items.
      consideration: [],
      salt: generateRandomSalt(),
      totalOriginalConsiderationItems: 0,
    },
    signature: "0x",
  };

  return counterOrder;
};

export const getPrivateListingFulfillments = (
  privateListingOrder: OrderWithCounter
): MatchOrdersFulfillment[] => {
  const nftRelatedFulfillments: MatchOrdersFulfillment[] = [];

  // For the original order, we need to match everything offered with every consideration item
  // on the original order that's set to go to the private listing recipient
  privateListingOrder.parameters.offer.forEach((offerItem, offerIndex) => {
    const considerationIndex =
      privateListingOrder.parameters.consideration.findIndex(
        (considerationItem) =>
          considerationItem.itemType === offerItem.itemType &&
          considerationItem.token === offerItem.token &&
          considerationItem.identifierOrCriteria ===
          offerItem.identifierOrCriteria
      );
    if (considerationIndex === -1) {
      throw new Error(
        "Could not find matching offer item in the consideration for private listing"
      );
    }
    nftRelatedFulfillments.push({
      offerComponents: [
        {
          orderIndex: 0,
          itemIndex: offerIndex,
        },
      ],
      considerationComponents: [
        {
          orderIndex: 0,
          itemIndex: considerationIndex,
        },
      ],
    });
  });

  const currencyRelatedFulfillments: MatchOrdersFulfillment[] = [];

  // For the original order, we need to match everything offered with every consideration item
  // on the original order that's set to go to the private listing recipient
  privateListingOrder.parameters.consideration.forEach(
    (considerationItem, considerationIndex) => {
      if (!isCurrencyItem(considerationItem)) {
        return;
      }
      // We always match the offer item (index 0) of the counter order (index 1)
      // with all of the payment items on the private listing
      currencyRelatedFulfillments.push({
        offerComponents: [
          {
            orderIndex: 1,
            itemIndex: 0,
          },
        ],
        considerationComponents: [
          {
            orderIndex: 0,
            itemIndex: considerationIndex,
          },
        ],
      });
    }
  );

  return [...nftRelatedFulfillments, ...currencyRelatedFulfillments];
};
