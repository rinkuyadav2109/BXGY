import {describe, expect, test} from "vitest";
import {buildComboDiscountResult} from "../src/combo-discount";

const PRODUCT_X = "gid://shopify/Product/1";
const PRODUCT_Y = "gid://shopify/Product/2";
const VARIANT_X = "gid://shopify/ProductVariant/11";
const VARIANT_Y = "gid://shopify/ProductVariant/22";

function line({
  id,
  quantity,
  price,
  productId,
  variantId,
  buysCollection = false,
  getsCollection = false,
  giftCard = false,
  sellingPlanId = null,
  parentId = null,
}) {
  return {
    id,
    quantity,
    cost: {
      amountPerQuantity: {amount: String(price)},
      subtotalAmount: {amount: String(price * quantity)},
    },
    parentRelationship: parentId ? {parent: {id: parentId}} : null,
    sellingPlanAllocation: sellingPlanId ? {sellingPlan: {id: sellingPlanId}} : null,
    merchandise: {
      __typename: "ProductVariant",
      id: variantId,
      product: {
        id: productId,
        isGiftCard: giftCard,
        inBuysCollection: buysCollection,
        inGetsCollection: getsCollection,
      },
    },
  };
}

function xLine(quantity, price = 25, id = "gid://shopify/CartLine/x") {
  return line({id, quantity, price, productId: PRODUCT_X, variantId: VARIANT_X});
}

function yLine(quantity, price = 40, id = "gid://shopify/CartLine/y") {
  return line({id, quantity, price, productId: PRODUCT_Y, variantId: VARIANT_Y});
}

function comboConfig(overrides = {}) {
  return {
    buysCollectionIds: [],
    getsCollectionIds: [],
    customerBuys: {
      requirement: "quantity",
      quantity: 1,
      amount: 0,
      itemType: "products",
      purchaseType: "BOTH",
      products: [{id: PRODUCT_X, variantIds: []}],
      collections: [],
      ...overrides.customerBuys,
    },
    customerGets: {
      quantity: 1,
      itemType: "products",
      purchaseType: "BOTH",
      products: [{id: PRODUCT_Y, variantIds: []}],
      collections: [],
      ...overrides.customerGets,
    },
    discountValue: {
      type: "percentage",
      percentage: 20,
      fixedAmount: 0,
      ...overrides.discountValue,
    },
    maxUsesPerOrder: Object.prototype.hasOwnProperty.call(overrides, "maxUsesPerOrder")
      ? overrides.maxUsesPerOrder
      : null,
    restrictQuantity: Boolean(overrides.restrictQuantity),
  };
}

function run(lines, configuration, {rate = "1.0", classes = ["PRODUCT"]} = {}) {
  return buildComboDiscountResult({
    cart: {lines},
    discount: {
      discountClasses: classes,
      metafield: configuration == null ? null : {jsonValue: configuration},
    },
    presentmentCurrencyRate: rate,
  });
}

function candidate(result) {
  return result.operations[0]?.productDiscountsAdd?.candidates?.[0];
}

function quantities(result) {
  return (candidate(result)?.targets ?? []).map((target) => [
    target.cartLine.id,
    target.cartLine.quantity,
  ]);
}

describe("combo discount", () => {
  test("discounts one unit of X and one unit of Y when a second X is in the cart", () => {
    const result = run([xLine(2, 25), yLine(1, 40)], comboConfig());

    expect(quantities(result)).toEqual([
      ["gid://shopify/CartLine/x", 1],
      ["gid://shopify/CartLine/y", 1],
    ]);
    expect(candidate(result).message).toBeUndefined();
    expect(candidate(result).value).toEqual({percentage: {value: 20}});
    expect(result.operations[0].productDiscountsAdd.selectionStrategy).toBe("ALL");
  });

  test("discounts every complete set when no maximum is set", () => {
    const result = run([xLine(2), yLine(2)], comboConfig());
    expect(quantities(result)).toEqual([
      ["gid://shopify/CartLine/x", 2],
      ["gid://shopify/CartLine/y", 2],
    ]);
  });

  test("stops at the maximum number of uses per order", () => {
    const result = run([xLine(2), yLine(2)], comboConfig({maxUsesPerOrder: 1}));
    expect(quantities(result)).toEqual([
      ["gid://shopify/CartLine/x", 1],
      ["gid://shopify/CartLine/y", 1],
    ]);
  });

  test("requires the full buy quantity before either side is discounted", () => {
    const result = run(
      [xLine(1), yLine(1)],
      comboConfig({customerBuys: {quantity: 2}}),
    );
    expect(result.operations).toEqual([]);
  });

  test("caps each side at its own quantity", () => {
    const buysTwoGetsOne = run(
      [xLine(5), yLine(1)],
      comboConfig({customerBuys: {quantity: 2}}),
    );
    expect(quantities(buysTwoGetsOne)).toEqual([
      ["gid://shopify/CartLine/x", 2],
      ["gid://shopify/CartLine/y", 1],
    ]);

    const buysOneGetsTwo = run(
      [xLine(1), yLine(5)],
      comboConfig({customerGets: {quantity: 2}}),
    );
    expect(quantities(buysOneGetsTwo)).toEqual([
      ["gid://shopify/CartLine/x", 1],
      ["gid://shopify/CartLine/y", 2],
    ]);
  });

  test("does not discount when either group is missing", () => {
    expect(run([xLine(2)], comboConfig()).operations).toEqual([]);
    expect(run([yLine(2)], comboConfig()).operations).toEqual([]);
  });

  test("discounts the lowest-priced buy units when the quantity is limited", () => {
    const result = run(
      [
        line({
          id: "gid://shopify/CartLine/expensive",
          quantity: 1,
          price: 50,
          productId: PRODUCT_X,
          variantId: "gid://shopify/ProductVariant/expensive",
        }),
        line({
          id: "gid://shopify/CartLine/cheap",
          quantity: 1,
          price: 5,
          productId: PRODUCT_X,
          variantId: "gid://shopify/ProductVariant/cheap",
        }),
        yLine(1),
      ],
      comboConfig(),
    );

    expect(quantities(result)).toEqual([
      ["gid://shopify/CartLine/cheap", 1],
      ["gid://shopify/CartLine/y", 1],
    ]);
  });

  test("keeps a shared unit available for Customer gets", () => {
    const result = run(
      [
        line({
          id: "gid://shopify/CartLine/shared",
          quantity: 1,
          price: 5,
          productId: PRODUCT_X,
          variantId: VARIANT_X,
        }),
        line({
          id: "gid://shopify/CartLine/x-only",
          quantity: 1,
          price: 50,
          productId: PRODUCT_X,
          variantId: "gid://shopify/ProductVariant/x-only",
        }),
      ],
      comboConfig({
        customerGets: {
          products: [{id: PRODUCT_X, variantIds: [VARIANT_X]}],
        },
      }),
    );

    expect(quantities(result)).toEqual([
      ["gid://shopify/CartLine/shared", 1],
      ["gid://shopify/CartLine/x-only", 1],
    ]);
  });

  test("repeats on one product when it is both Customer buys and Customer gets", () => {
    const configuration = comboConfig({
      customerGets: {products: [{id: PRODUCT_X, variantIds: []}]},
    });

    expect(quantities(run([xLine(3)], configuration))).toEqual([
      ["gid://shopify/CartLine/x", 2],
    ]);
    expect(quantities(run([xLine(4)], configuration))).toEqual([
      ["gid://shopify/CartLine/x", 4],
    ]);
    expect(run([xLine(1)], configuration).operations).toEqual([]);
  });

  test("applies a fixed amount to each discounted unit and converts presentment currency", () => {
    const configuration = comboConfig({
      discountValue: {type: "fixed", fixedAmount: "5.00"},
    });

    const shopCurrency = run([xLine(2), yLine(1)], configuration);
    expect(candidate(shopCurrency).message).toBeUndefined();
    expect(candidate(shopCurrency).value).toEqual({
      fixedAmount: {amount: "5.00", appliesToEachItem: true},
    });

    const presentment = run([xLine(2), yLine(1)], configuration, {rate: "2"});
    expect(candidate(presentment).value.fixedAmount.amount).toBe("10.00");
    expect(candidate(presentment).value.percentage).toBeUndefined();
  });

  test("does not convert a percentage by the presentment rate", () => {
    const result = run([xLine(1), yLine(1)], comboConfig(), {rate: "2"});
    expect(candidate(result).value).toEqual({percentage: {value: 20}});
  });

  test("discounts only the selected variants", () => {
    const configuration = comboConfig({
      customerBuys: {
        products: [{id: PRODUCT_X, variantIds: ["gid://shopify/ProductVariant/small"]}],
      },
    });
    const result = run(
      [
        line({
          id: "gid://shopify/CartLine/small",
          quantity: 1,
          price: 10,
          productId: PRODUCT_X,
          variantId: "gid://shopify/ProductVariant/small",
        }),
        line({
          id: "gid://shopify/CartLine/large",
          quantity: 1,
          price: 10,
          productId: PRODUCT_X,
          variantId: "gid://shopify/ProductVariant/large",
        }),
        yLine(1),
      ],
      configuration,
    );

    expect(quantities(result)).toEqual([
      ["gid://shopify/CartLine/small", 1],
      ["gid://shopify/CartLine/y", 1],
    ]);
  });

  test("matches collection membership from the input query", () => {
    const configuration = comboConfig({
      customerBuys: {itemType: "collections", products: [], collections: [{id: "gid://shopify/Collection/1"}]},
      customerGets: {itemType: "collections", products: [], collections: [{id: "gid://shopify/Collection/2"}]},
    });
    const result = run(
      [
        line({
          id: "gid://shopify/CartLine/x",
          quantity: 2,
          price: 10,
          productId: PRODUCT_X,
          variantId: VARIANT_X,
          buysCollection: true,
        }),
        line({
          id: "gid://shopify/CartLine/y",
          quantity: 1,
          price: 10,
          productId: PRODUCT_Y,
          variantId: VARIANT_Y,
          getsCollection: true,
        }),
        line({
          id: "gid://shopify/CartLine/other",
          quantity: 1,
          price: 10,
          productId: "gid://shopify/Product/9",
          variantId: "gid://shopify/ProductVariant/9",
        }),
      ],
      configuration,
    );

    expect(quantities(result)).toEqual([
      ["gid://shopify/CartLine/x", 1],
      ["gid://shopify/CartLine/y", 1],
    ]);
  });

  test("respects one-time and subscription purchase types", () => {
    const oneTime = comboConfig({
      customerBuys: {purchaseType: "ONE_TIME"},
      customerGets: {purchaseType: "ONE_TIME"},
    });
    const subscriptionLine = xLine(1);
    subscriptionLine.sellingPlanAllocation = {sellingPlan: {id: "gid://shopify/SellingPlan/1"}};

    expect(run([subscriptionLine, yLine(1)], oneTime).operations).toEqual([]);

    const subscription = comboConfig({
      customerBuys: {purchaseType: "SUBSCRIPTION"},
      customerGets: {purchaseType: "SUBSCRIPTION"},
    });
    const subscriptionY = yLine(1);
    subscriptionY.sellingPlanAllocation = {sellingPlan: {id: "gid://shopify/SellingPlan/2"}};
    expect(quantities(run([subscriptionLine, subscriptionY], subscription))).toEqual([
      ["gid://shopify/CartLine/x", 1],
      ["gid://shopify/CartLine/y", 1],
    ]);
  });

  test("skips gift cards and nested cart lines", () => {
    expect(
      run(
        [
          line({
            id: "gid://shopify/CartLine/x",
            quantity: 1,
            price: 10,
            productId: PRODUCT_X,
            variantId: VARIANT_X,
            giftCard: true,
          }),
          yLine(1),
        ],
        comboConfig(),
      ).operations,
    ).toEqual([]);

    expect(
      run(
        [
          line({
            id: "gid://shopify/CartLine/x",
            quantity: 1,
            price: 10,
            productId: PRODUCT_X,
            variantId: VARIANT_X,
            parentId: "gid://shopify/CartLine/parent",
          }),
          yLine(1),
        ],
        comboConfig(),
      ).operations,
    ).toEqual([]);
  });

  test("minimum purchase amount discounts only the units needed to reach it", () => {
    const configuration = comboConfig({
      customerBuys: {requirement: "amount", amount: "50"},
    });

    const oneSet = run(
      [
        line({
          id: "gid://shopify/CartLine/x",
          quantity: 4,
          price: 20,
          productId: PRODUCT_X,
          variantId: VARIANT_X,
        }),
        yLine(1),
      ],
      configuration,
    );
    expect(quantities(oneSet)).toEqual([
      ["gid://shopify/CartLine/x", 3],
      ["gid://shopify/CartLine/y", 1],
    ]);

    const twoSets = run(
      [
        line({
          id: "gid://shopify/CartLine/x",
          quantity: 6,
          price: 20,
          productId: PRODUCT_X,
          variantId: VARIANT_X,
        }),
        yLine(2),
      ],
      configuration,
    );
    expect(quantities(twoSets)).toEqual([
      ["gid://shopify/CartLine/x", 6],
      ["gid://shopify/CartLine/y", 2],
    ]);

    const shortSpend = run(
      [
        line({
          id: "gid://shopify/CartLine/x",
          quantity: 2,
          price: 20,
          productId: PRODUCT_X,
          variantId: VARIANT_X,
        }),
        yLine(1),
      ],
      configuration,
    );
    expect(shortSpend.operations).toEqual([]);
  });

  test("minimum purchase amount uses the highest-priced units and leaves cheaper extras", () => {
    const result = run(
      [
        line({
          id: "gid://shopify/CartLine/cheap",
          quantity: 1,
          price: 10,
          productId: PRODUCT_X,
          variantId: "gid://shopify/ProductVariant/cheap",
        }),
        line({
          id: "gid://shopify/CartLine/expensive",
          quantity: 1,
          price: 100,
          productId: PRODUCT_X,
          variantId: "gid://shopify/ProductVariant/expensive",
        }),
        yLine(1),
      ],
      comboConfig({customerBuys: {requirement: "amount", amount: "50"}}),
    );

    expect(quantities(result)).toEqual([
      ["gid://shopify/CartLine/expensive", 1],
      ["gid://shopify/CartLine/y", 1],
    ]);
  });

  test("minimum purchase amount prefers an exclusive buy unit over a shared unit", () => {
    const result = run(
      [
        line({
          id: "gid://shopify/CartLine/shared",
          quantity: 1,
          price: 60,
          productId: PRODUCT_X,
          variantId: VARIANT_X,
        }),
        line({
          id: "gid://shopify/CartLine/x-only",
          quantity: 1,
          price: 60,
          productId: PRODUCT_X,
          variantId: "gid://shopify/ProductVariant/x-only",
        }),
      ],
      comboConfig({
        customerBuys: {requirement: "amount", amount: "50"},
        customerGets: {products: [{id: PRODUCT_X, variantIds: [VARIANT_X]}]},
      }),
    );

    expect(quantities(result)).toEqual([
      ["gid://shopify/CartLine/shared", 1],
      ["gid://shopify/CartLine/x-only", 1],
    ]);
  });

  test("converts the minimum purchase amount into presentment currency", () => {
    const result = run(
      [
        line({
          id: "gid://shopify/CartLine/x",
          quantity: 2,
          price: 60,
          productId: PRODUCT_X,
          variantId: VARIANT_X,
        }),
        yLine(1),
      ],
      comboConfig({customerBuys: {requirement: "amount", amount: "50"}}),
      {rate: "2"},
    );

    expect(quantities(result)).toEqual([
      ["gid://shopify/CartLine/x", 2],
      ["gid://shopify/CartLine/y", 1],
    ]);
  });

  test("rejects free, empty, and non-product discounts", () => {
    expect(
      run([xLine(1), yLine(1)], comboConfig({discountValue: {type: "free", percentage: 100}}))
        .operations,
    ).toEqual([]);
    expect(run([xLine(1), yLine(1)], comboConfig({discountValue: {percentage: 0}})).operations).toEqual(
      [],
    );
    expect(run([xLine(1), yLine(1)], {cartLinePercentage: 10}).operations).toEqual([]);
    expect(run([xLine(1), yLine(1)], comboConfig(), {classes: ["ORDER"]}).operations).toEqual([]);
    expect(run([], comboConfig()).operations).toEqual([]);
    expect(
      run([xLine(1), yLine(1)], JSON.stringify(comboConfig())).operations[0].productDiscountsAdd
        .candidates[0].message,
    ).toBeUndefined();
  });

  test("discounts only customer gets when customer buys is not configured", () => {
    const configuration = comboConfig({maxUsesPerOrder: 1});
    delete configuration.customerBuys;

    expect(quantities(run([xLine(2), yLine(3)], configuration))).toEqual([
      ["gid://shopify/CartLine/y", 1],
    ]);

    const uncapped = comboConfig({customerGets: {quantity: 2}});
    delete uncapped.customerBuys;
    expect(quantities(run([yLine(5)], uncapped))).toEqual([["gid://shopify/CartLine/y", 4]]);
    expect(run([xLine(2)], uncapped).operations).toEqual([]);
  });

  test("restricts the offer to one unit of X and one unit of Y when enabled", () => {
    const configuration = comboConfig({restrictQuantity: true});

    expect(quantities(run([xLine(3), yLine(3)], configuration))).toEqual([
      ["gid://shopify/CartLine/x", 1],
      ["gid://shopify/CartLine/y", 1],
    ]);
    expect(quantities(run([xLine(2), yLine(1)], configuration))).toEqual([
      ["gid://shopify/CartLine/x", 1],
      ["gid://shopify/CartLine/y", 1],
    ]);
    expect(run([xLine(3)], configuration).operations).toEqual([]);
  });

  test("applies the offer to every matching pair when quantity restriction is off", () => {
    expect(quantities(run([xLine(2), yLine(2)], comboConfig()))).toEqual([
      ["gid://shopify/CartLine/x", 2],
      ["gid://shopify/CartLine/y", 2],
    ]);
    expect(quantities(run([xLine(3), yLine(4)], comboConfig()))).toEqual([
      ["gid://shopify/CartLine/x", 3],
      ["gid://shopify/CartLine/y", 3],
    ]);
  });
});
