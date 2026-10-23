// node_modules/@shopify/shopify_function/run.ts
function run_default(userfunction) {
  try {
    ShopifyFunction;
  } catch (e) {
    throw new Error(
      "ShopifyFunction is not defined. Please rebuild your function using the latest version of Shopify CLI."
    );
  }
  const input_obj = ShopifyFunction.readInput();
  const output_obj = userfunction(input_obj);
  ShopifyFunction.writeOutput(output_obj);
}

// extensions/bxgy-combo-logic/src/combo-discount.js
var MAX_RESOURCES = 100;
function buildComboDiscountResult(input) {
  try {
    return buildComboDiscountResultUnsafe(input);
  } catch {
    return { operations: [] };
  }
}
function buildComboDiscountResultUnsafe(input) {
  const classes = input?.discount?.discountClasses ?? [];
  if (!classes.includes("PRODUCT")) {
    return { operations: [] };
  }
  const config = parseComboConfig(input?.discount?.metafield?.jsonValue);
  if (!config) {
    return { operations: [] };
  }
  const rate = currencyRate(input?.presentmentCurrencyRate);
  const lines = eligibleLines(input?.cart?.lines, config);
  const allocated = config.restrictQuantity ? allocateRestrictedOneUnit(lines, config) : config.customerBuys ? config.customerBuys.requirement === "amount" ? allocateByAmount(lines, config, presentmentCents(config.customerBuys.amount, rate)) : allocateByQuantity(lines, config) : allocateGetsOnly(lines, config);
  if (!allocated.length) {
    return { operations: [] };
  }
  return {
    operations: [
      {
        productDiscountsAdd: {
          candidates: [
            {
              targets: allocated.map((target) => ({
                cartLine: {
                  id: target.id,
                  quantity: target.quantity
                }
              })),
              value: discountValue(config, rate)
            }
          ],
          selectionStrategy: "ALL"
        }
      }
    ]
  };
}
function parseComboConfig(value) {
  const raw = unwrapJson(value);
  if (!raw || typeof raw !== "object") return null;
  const customerGets = parseGets(raw.customerGets);
  const discount = parseDiscountValue(raw.discountValue);
  if (!customerGets || !discount) return null;
  let customerBuys = null;
  if (raw.customerBuys != null) {
    customerBuys = parseBuys(raw.customerBuys);
    if (!customerBuys) return null;
  }
  let maxUsesPerOrder = null;
  if (raw.maxUsesPerOrder != null && raw.maxUsesPerOrder !== "") {
    maxUsesPerOrder = parsePositiveInt(raw.maxUsesPerOrder);
    if (!maxUsesPerOrder) return null;
  }
  return {
    customerBuys,
    customerGets,
    discountValue: discount,
    maxUsesPerOrder,
    restrictQuantity: Boolean(raw.restrictQuantity)
  };
}
function parseBuys(group) {
  if (!group || typeof group !== "object") return null;
  if (group.requirement !== "quantity" && group.requirement !== "amount") return null;
  const quantity = group.requirement === "quantity" ? parsePositiveInt(group.quantity) : 0;
  if (group.requirement === "quantity" && !quantity) return null;
  const amountCents = toCents(group.amount);
  if (group.requirement === "amount" && amountCents < 1) return null;
  const items = parseItems(group);
  if (!items) return null;
  return {
    requirement: group.requirement,
    quantity: quantity || 0,
    amount: group.requirement === "amount" ? amountCents / 100 : 0,
    ...items
  };
}
function parseGets(group) {
  if (!group || typeof group !== "object") return null;
  const quantity = parsePositiveInt(group.quantity);
  if (!quantity) return null;
  const items = parseItems(group);
  if (!items) return null;
  return { quantity, ...items };
}
function parseItems(group) {
  if (group.itemType !== "products" && group.itemType !== "collections") return null;
  if (!["ONE_TIME", "SUBSCRIPTION", "BOTH"].includes(group.purchaseType)) return null;
  const products = parseProducts(group.products);
  const collections = parseCollections(group.collections);
  if (!products || !collections) return null;
  if (group.itemType === "products" && (products.length === 0 || products.length > MAX_RESOURCES)) {
    return null;
  }
  if (group.itemType === "collections" && (collections.length === 0 || collections.length > MAX_RESOURCES)) {
    return null;
  }
  return {
    itemType: group.itemType,
    purchaseType: group.purchaseType,
    products,
    collections
  };
}
function parseProducts(products) {
  if (products == null) return [];
  if (!Array.isArray(products)) return null;
  const parsed = [];
  for (const product of products) {
    if (!product || typeof product.id !== "string" || product.id === "") return null;
    const variantIds = Array.isArray(product.variantIds) ? product.variantIds.filter((id) => typeof id === "string" && id !== "") : [];
    parsed.push({ id: product.id, variantIds });
  }
  return parsed;
}
function parseCollections(collections) {
  if (collections == null) return [];
  if (!Array.isArray(collections)) return null;
  const parsed = [];
  for (const collection of collections) {
    if (!collection || typeof collection.id !== "string" || collection.id === "") return null;
    parsed.push({ id: collection.id });
  }
  return parsed;
}
function parseDiscountValue(value) {
  if (!value || typeof value !== "object") return null;
  if (value.type === "percentage") {
    const percentage = Math.round(Number(value.percentage) * 100) / 100;
    if (!Number.isFinite(percentage) || percentage <= 0 || percentage > 100) return null;
    return { type: "percentage", percentage, fixedAmount: 0 };
  }
  if (value.type === "fixed") {
    const fixedCents = toCents(value.fixedAmount);
    if (fixedCents < 1) return null;
    return { type: "fixed", percentage: 0, fixedAmount: fixedCents / 100 };
  }
  return null;
}
function eligibleLines(cartLines, config) {
  const lines = [];
  for (const line of cartLines ?? []) {
    const annotated = annotateLine(line, config);
    if (annotated) lines.push(annotated);
  }
  return lines;
}
function annotateLine(line, config) {
  if (!line?.id || !Number.isInteger(line.quantity) || line.quantity <= 0) return null;
  if (line.parentRelationship?.parent?.id) return null;
  const merchandise = line.merchandise;
  if (!merchandise || merchandise.__typename !== "ProductVariant") return null;
  if (merchandise.product?.isGiftCard) return null;
  const buys = config.customerBuys ? matchesGroup(line, config.customerBuys, merchandise.product?.inBuysCollection) : false;
  const gets = matchesGroup(line, config.customerGets, merchandise.product?.inGetsCollection);
  if (!buys && !gets) return null;
  return {
    id: line.id,
    quantity: line.quantity,
    unitCents: Math.max(0, toCents(line.cost?.amountPerQuantity?.amount)),
    buys,
    gets
  };
}
function matchesGroup(line, group, inCollection) {
  if (!matchesPurchaseType(line, group.purchaseType)) return false;
  if (group.itemType === "collections") return Boolean(inCollection);
  const productId = line.merchandise?.product?.id;
  const variantId = line.merchandise?.id;
  return group.products.some((product) => {
    if (product.id !== productId) return false;
    if (product.variantIds.length === 0) return true;
    return product.variantIds.includes(variantId);
  });
}
function matchesPurchaseType(line, purchaseType) {
  const subscription = Boolean(line.sellingPlanAllocation?.sellingPlan?.id);
  if (purchaseType === "SUBSCRIPTION") return subscription;
  if (purchaseType === "ONE_TIME") return !subscription;
  return true;
}
function allocateRestrictedOneUnit(lines, config) {
  if (config.customerBuys) {
    const { xOnly, yOnly, shared } = splitGroups(lines);
    const remaining = remainingMap(lines);
    const reserved = {};
    const xTaken = takeQuantity([xOnly, shared], remaining, reserved, 1);
    if (!xTaken) return [];
    reserve(reserved, xTaken);
    const yTaken = takeQuantity([yOnly, shared], remaining, reserved, 1);
    if (!yTaken) return [];
    return toTargets(lines, discountedMap([xTaken, yTaken]));
  }
  const gets = lines.filter((line) => line.gets);
  const taken = takeQuantity([gets], remainingMap(gets), {}, 1);
  if (!taken) return [];
  return toTargets(gets, discountedMap([taken]));
}
function allocateGetsOnly(lines, config) {
  const gets = lines.filter((line) => line.gets);
  const quantity = config.customerGets.quantity;
  let uses = Math.floor(totalQuantity(gets) / quantity);
  uses = capUses(uses, config, gets);
  if (uses <= 0) return [];
  const taken = takeQuantity([gets], remainingMap(gets), {}, uses * quantity);
  if (!taken) return [];
  return toTargets(gets, discountedMap([taken]));
}
function allocateByQuantity(lines, config) {
  const buyQty = config.customerBuys.quantity;
  const getQty = config.customerGets.quantity;
  const { xOnly, yOnly, shared } = splitGroups(lines);
  const xOnlyQty = totalQuantity(xOnly);
  const yOnlyQty = totalQuantity(yOnly);
  const sharedQty = totalQuantity(shared);
  let uses = Math.min(
    Math.floor((xOnlyQty + sharedQty) / buyQty),
    Math.floor((yOnlyQty + sharedQty) / getQty),
    Math.floor((xOnlyQty + yOnlyQty + sharedQty) / (buyQty + getQty))
  );
  uses = capUses(uses, config, lines);
  if (uses <= 0) return [];
  const remaining = remainingMap(lines);
  const reserved = {};
  const xTaken = takeQuantity([xOnly, shared], remaining, reserved, uses * buyQty);
  if (!xTaken) return [];
  reserve(reserved, xTaken);
  const yTaken = takeQuantity([yOnly, shared], remaining, reserved, uses * getQty);
  if (!yTaken) return [];
  return toTargets(lines, discountedMap([xTaken, yTaken]));
}
function allocateByAmount(lines, config, thresholdCents) {
  if (thresholdCents < 1) return [];
  const { xOnly, yOnly, shared } = splitGroups(lines);
  const remaining = remainingMap(lines);
  const discounted = {};
  const cap = capUses(Number.POSITIVE_INFINITY, config, lines);
  for (let use = 0; use < cap; use += 1) {
    const reserved = {};
    const xTaken = takeUntilSpend([xOnly, shared], remaining, reserved, thresholdCents);
    if (!xTaken) break;
    reserve(reserved, xTaken);
    const yTaken = takeQuantity([yOnly, shared], remaining, reserved, config.customerGets.quantity);
    if (!yTaken) break;
    applyTaken(remaining, discounted, xTaken);
    applyTaken(remaining, discounted, yTaken);
  }
  return toTargets(lines, discounted);
}
function splitGroups(lines) {
  return {
    xOnly: lines.filter((line) => line.buys && !line.gets),
    yOnly: lines.filter((line) => line.gets && !line.buys),
    shared: lines.filter((line) => line.buys && line.gets)
  };
}
function takeQuantity(pools, remaining, reserved, need) {
  if (need < 1) return null;
  const taken = [];
  let left = need;
  for (const pool of pools) {
    const sorted = [...pool].sort((a, b) => comparePrice(a, b, "asc"));
    for (const line of sorted) {
      if (left <= 0) break;
      const available = availableQuantity(line.id, remaining, reserved);
      if (available <= 0) continue;
      const quantity = Math.min(available, left);
      taken.push({ id: line.id, quantity });
      left -= quantity;
    }
  }
  return left === 0 ? mergeTaken(taken) : null;
}
function takeUntilSpend(pools, remaining, reserved, thresholdCents) {
  const taken = [];
  let spent = 0;
  for (const pool of pools) {
    const sorted = [...pool].sort((a, b) => comparePrice(a, b, "desc"));
    for (const line of sorted) {
      if (spent >= thresholdCents) break;
      const available = availableQuantity(line.id, remaining, reserved) - stagedQuantity(taken, line.id);
      if (available <= 0 || line.unitCents <= 0) continue;
      const unitsNeeded = Math.ceil((thresholdCents - spent) / line.unitCents);
      const quantity = Math.min(available, unitsNeeded);
      if (quantity <= 0) continue;
      taken.push({ id: line.id, quantity });
      spent += quantity * line.unitCents;
    }
  }
  return spent >= thresholdCents ? mergeTaken(taken) : null;
}
function stagedQuantity(taken, id) {
  return taken.reduce((sum, item) => item.id === id ? sum + item.quantity : sum, 0);
}
function availableQuantity(id, remaining, reserved) {
  return (remaining[id] || 0) - (reserved[id] || 0);
}
function reserve(reserved, taken) {
  for (const item of taken) {
    reserved[item.id] = (reserved[item.id] || 0) + item.quantity;
  }
}
function applyTaken(remaining, discounted, taken) {
  for (const item of taken) {
    remaining[item.id] -= item.quantity;
    discounted[item.id] = (discounted[item.id] || 0) + item.quantity;
  }
}
function discountedMap(groups) {
  const discounted = {};
  for (const group of groups) {
    for (const item of group) {
      discounted[item.id] = (discounted[item.id] || 0) + item.quantity;
    }
  }
  return discounted;
}
function toTargets(lines, discounted) {
  return lines.map((line) => ({
    id: line.id,
    quantity: Math.min(discounted[line.id] || 0, line.quantity)
  })).filter((target) => target.quantity > 0);
}
function mergeTaken(taken) {
  const quantities = {};
  for (const item of taken) {
    quantities[item.id] = (quantities[item.id] || 0) + item.quantity;
  }
  return Object.entries(quantities).map(([id, quantity]) => ({ id, quantity }));
}
function remainingMap(lines) {
  return Object.fromEntries(lines.map((line) => [line.id, line.quantity]));
}
function totalQuantity(lines) {
  return lines.reduce((sum, line) => sum + line.quantity, 0);
}
function capUses(uses, config, lines) {
  const totalUnits = totalQuantity(lines);
  const limited = config.maxUsesPerOrder == null ? uses : Math.min(uses, config.maxUsesPerOrder);
  return Math.max(0, Math.min(limited, totalUnits));
}
function comparePrice(a, b, direction) {
  const difference = direction === "desc" ? b.unitCents - a.unitCents : a.unitCents - b.unitCents;
  if (difference !== 0) return difference;
  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
}
function discountValue(config, rate) {
  if (config.discountValue.type === "fixed") {
    return {
      fixedAmount: {
        amount: (presentmentCents(config.discountValue.fixedAmount, rate) / 100).toFixed(2),
        appliesToEachItem: true
      }
    };
  }
  return {
    percentage: {
      value: config.discountValue.percentage
    }
  };
}
function presentmentCents(shopAmount, rate) {
  return Math.round(toCents(shopAmount) * rate);
}
function currencyRate(rate) {
  const value = Number(rate);
  if (!Number.isFinite(value) || value <= 0) return 1;
  return value;
}
function toCents(amount) {
  const value = typeof amount === "number" ? amount : Number(String(amount ?? "").replace(/,/g, "").trim());
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100);
}
function parsePositiveInt(value) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) return null;
  return number;
}
function unwrapJson(value) {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

// extensions/bxgy-combo-logic/src/cart_lines_discounts_generate_run.js
function cartLinesDiscountsGenerateRun(input) {
  return buildComboDiscountResult(input);
}

// extensions/bxgy-combo-logic/src/cart_delivery_options_discounts_generate_run.js
function cartDeliveryOptionsDiscountsGenerateRun(input) {
  if (!input) return { operations: [] };
  return { operations: [] };
}

// <stdin>
function cartLinesDiscountsGenerateRun2() {
  return run_default(cartLinesDiscountsGenerateRun);
}
function cartDeliveryOptionsDiscountsGenerateRun2() {
  return run_default(cartDeliveryOptionsDiscountsGenerateRun);
}
export {
  cartDeliveryOptionsDiscountsGenerateRun2 as cartDeliveryOptionsDiscountsGenerateRun,
  cartLinesDiscountsGenerateRun2 as cartLinesDiscountsGenerateRun
};
