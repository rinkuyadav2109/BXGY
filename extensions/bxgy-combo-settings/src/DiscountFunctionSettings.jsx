/* eslint-disable react/prop-types -- Polaris admin components, not a public React API. */
import "@shopify/ui-extensions/preact";
import {render} from "preact";
import {useEffect, useRef, useState} from "preact/hooks";

const MAX_ITEMS = 100;

export default async () => {
  render(<App />, document.body);
};

function App() {
  const {i18n, applyMetafieldChange} = shopify;
  const translate = i18n.translate;
  const savedValue = shopify.data?.metafields?.find(
    (metafield) => metafield.key === "function-configuration",
  )?.value;
  const initialForm = formFromMetafield(savedValue);

  const [form, setForm] = useState(initialForm);
  const [baseline, setBaseline] = useState(initialForm);
  const [errors, setErrors] = useState({});
  const [classError, setClassError] = useState("");
  const submittedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    async function lockProductClass() {
      const classes = shopify.discounts?.discountClasses?.value ?? [];
      if (classes.length === 1 && classes[0] === "product") return;
      const result = await shopify.discounts?.updateDiscountClasses?.(["product"]);
      if (!cancelled && result && result.success === false) {
        setClassError(translate("errors.discountClass"));
      }
    }
    lockProductClass();
    return () => {
      cancelled = true;
    };
    // The product class only needs to be set when the page opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!submittedRef.current) return;
    setErrors(validateForm(form, shopify.i18n.translate));
    // Re-check only after the merchant edits the form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form]);

  const commit = (updater) => {
    setForm((current) => updater(current));
  };

  const save = async (current) => {
    const classResult = await shopify.discounts?.updateDiscountClasses?.(["product"]);
    if (classResult && classResult.success === false) {
      throw new Error(translate("errors.discountClass"));
    }

    const result = await applyMetafieldChange({
      type: "updateMetafield",
      namespace: "$app",
      key: "function-configuration",
      value: JSON.stringify(formToMetafield(current)),
      valueType: "json",
    });

    if (result?.type === "error") {
      throw new Error(result.message || translate("errors.save"));
    }

    setBaseline(current);
    setClassError("");
  };

  const hasErrors = Object.keys(errors).length > 0;

  return (
    <s-function-settings
      onSubmit={(event) => {
        const nextErrors = validateForm(form, translate);
        submittedRef.current = true;
        setErrors(nextErrors);
        if (Object.keys(nextErrors).length > 0) {
          event.waitUntil?.(Promise.reject(new Error(translate("errors.summary"))));
          return;
        }
        event.waitUntil?.(save(form));
      }}
      onReset={() => {
        submittedRef.current = false;
        setForm(baseline);
        setErrors({});
      }}
    >
      <s-heading>{translate("title")}</s-heading>
      <s-section>
        <s-stack gap="base">
          {classError ? <s-banner tone="critical">{classError}</s-banner> : null}
          {hasErrors ? (
            <s-banner tone="critical">{translate("errors.summary")}</s-banner>
          ) : null}
          <s-paragraph>{translate("intro")}</s-paragraph>
          <s-paragraph color="subdued">{translate("repeat")}</s-paragraph>

          <ProductGroup
            prefix="buys"
            label={translate("customerBuys.label")}
            help={translate("customerBuys.help")}
            quantityLabel={translate("customerBuys.quantity")}
            group={form.customerBuys}
            errors={errors}
            translate={translate}
            onChange={(partial) =>
              commit((current) => ({
                ...current,
                customerBuys: {...current.customerBuys, ...partial},
              }))
            }
          />

          <s-divider />

          <ProductGroup
            prefix="gets"
            label={translate("customerGets.label")}
            help={translate("customerGets.help")}
            quantityLabel={translate("customerGets.quantity")}
            group={form.customerGets}
            errors={errors}
            translate={translate}
            onChange={(partial) =>
              commit((current) => ({
                ...current,
                customerGets: {...current.customerGets, ...partial},
              }))
            }
          />

          <s-divider />

          <DiscountValue
            form={form}
            errors={errors}
            translate={translate}
            onChange={(partial) =>
              commit((current) => ({
                ...current,
                discountValue: {...current.discountValue, ...partial},
              }))
            }
            onUsesChange={(partial) => commit((current) => ({...current, ...partial}))}
          />
        </s-stack>
      </s-section>
    </s-function-settings>
  );
}

function ProductGroup({
  prefix,
  label,
  help,
  quantityLabel,
  group,
  errors,
  translate,
  onChange,
}) {
  return (
    <s-stack gap="base">
      <s-text type="strong">{label}</s-text>
      <s-paragraph color="subdued">{help}</s-paragraph>
      <s-grid
        gridTemplateColumns="minmax(140px, 180px) minmax(180px, 1fr) minmax(180px, 1fr)"
        gap="base"
      >
        <s-number-field
          label={quantityLabel}
          name={`${prefix}-quantity`}
          value={group.quantity}
          min={1}
          step={1}
          required
          error={errors[`${prefix}Quantity`]}
          {...fieldHandlers((value) => onChange({quantity: value}))}
        />
        <ItemTypeSelect
          name={`${prefix}-items`}
          value={group.itemType}
          translate={translate}
          onChange={(itemType) => onChange({itemType})}
        />
        <PurchaseTypeSelect
          name={`${prefix}-purchase`}
          value={group.purchaseType}
          translate={translate}
          onChange={(purchaseType) => onChange({purchaseType})}
        />
      </s-grid>
      <ResourceField
        name={`${prefix}-search`}
        itemType={group.itemType}
        resources={group.itemType === "collections" ? group.collections : group.products}
        error={errors[`${prefix}Items`]}
        translate={translate}
        onChange={(resources) =>
          onChange(
            group.itemType === "collections"
              ? {collections: resources}
              : {products: resources},
          )
        }
      />
    </s-stack>
  );
}

function DiscountValue({form, errors, translate, onChange, onUsesChange}) {
  const value = form.discountValue;
  return (
    <s-stack gap="base">
      <s-choice-list
        label={translate("discountValue.label")}
        name="discount-value"
        details={translate("discountValue.help")}
        values={[value.type]}
        onChange={(event) => onChange({type: selectedChoice(event)})}
      >
        <s-choice value="percentage">{translate("discountValue.percentage")}</s-choice>
        <s-choice value="fixed">{translate("discountValue.fixed")}</s-choice>
      </s-choice-list>

      {value.type === "fixed" ? (
        <s-box maxInlineSize="180px" paddingInlineStart="large">
          <s-money-field
            label={translate("discountValue.fixed")}
            labelAccessibilityVisibility="exclusive"
            name="fixed-amount"
            value={value.fixedAmount}
            min={0.01}
            required
            error={errors.fixedAmount}
            {...fieldHandlers((amount) => onChange({fixedAmount: amount}))}
          />
        </s-box>
      ) : (
        <s-box maxInlineSize="180px" paddingInlineStart="large">
          <s-number-field
            label={translate("discountValue.percentage")}
            labelAccessibilityVisibility="exclusive"
            name="percentage"
            value={value.percentage}
            min={0.01}
            max={100}
            step={0.01}
            suffix="%"
            required
            error={errors.percentage}
            {...fieldHandlers((percentage) => onChange({percentage}))}
          />
        </s-box>
      )}

      <s-checkbox
        label={translate("maxUses.label")}
        name="limit-uses"
        checked={form.limitUses}
        onChange={(event) => onUsesChange({limitUses: isChecked(event)})}
      />
      {form.limitUses ? (
        <s-box maxInlineSize="180px" paddingInlineStart="large">
          <s-number-field
            label={translate("maxUses.quantity")}
            name="max-uses"
            details={translate("maxUses.help")}
            value={form.maxUsesPerOrder}
            min={1}
            step={1}
            required
            error={errors.maxUses}
            {...fieldHandlers((maxUsesPerOrder) => onUsesChange({maxUsesPerOrder}))}
          />
        </s-box>
      ) : null}
    </s-stack>
  );
}

function ItemTypeSelect({name, value, translate, onChange}) {
  return (
    <s-select
      label={translate("itemsFrom")}
      name={name}
      value={value}
      onChange={(event) => onChange(event.currentTarget.value)}
    >
      <s-option value="products">{translate("itemType.products")}</s-option>
      <s-option value="collections">{translate("itemType.collections")}</s-option>
    </s-select>
  );
}

function PurchaseTypeSelect({name, value, translate, onChange}) {
  return (
    <s-select
      label={translate("purchaseType.label")}
      name={name}
      value={value}
      onChange={(event) => onChange(event.currentTarget.value)}
    >
      <s-option value="ONE_TIME">{translate("purchaseType.oneTime")}</s-option>
      <s-option value="SUBSCRIPTION">{translate("purchaseType.subscription")}</s-option>
      <s-option value="BOTH">{translate("purchaseType.both")}</s-option>
    </s-select>
  );
}

function ResourceField({name, itemType, resources, error, translate, onChange}) {
  const pickerLockRef = useRef(false);
  const searchLabel =
    itemType === "collections"
      ? translate("search.collections")
      : translate("search.products");

  const openPicker = async () => {
    if (pickerLockRef.current) return;
    pickerLockRef.current = true;
    try {
      const pickerOptions = {
        type: itemType === "collections" ? "collection" : "product",
        multiple: MAX_ITEMS,
        action: "select",
        selectionIds: resources.map((resource) => ({
          id: resource.id,
          ...(itemType === "products" && resource.variantIds?.length
            ? {variants: resource.variantIds.map((id) => ({id}))}
            : {}),
        })),
      };
      if (itemType === "products") {
        pickerOptions.filter = {
          archived: false,
          draft: false,
          hidden: false,
          variants: true,
        };
      }
      const selection = await shopify.resourcePicker(pickerOptions);
      const picked = asList(selection);
      if (!picked) return;
      onChange(
        picked.map((resource) =>
          itemType === "collections"
            ? normalizeCollection(resource)
            : normalizeProduct(resource),
        ),
      );
    } finally {
      setTimeout(() => {
        pickerLockRef.current = false;
      }, 400);
    }
  };

  return (
    <s-stack gap="small">
      <s-grid gridTemplateColumns="1fr auto" gap="base" alignItems="end">
        <s-search-field
          label={searchLabel}
          labelAccessibilityVisibility="exclusive"
          name={name}
          placeholder={searchLabel}
          error={error}
          onFocus={openPicker}
        />
        <s-button type="button" onClick={openPicker}>
          {translate("search.browse")}
        </s-button>
      </s-grid>
      <SelectedResources
        resources={resources}
        resourceKind={itemType === "collections" ? "collections" : "products"}
        translate={translate}
        onRemove={(id) => onChange(resources.filter((resource) => resource.id !== id))}
      />
    </s-stack>
  );
}

function SelectedResources({resources, resourceKind, translate, onRemove}) {
  if (resources.length === 0) return null;

  return resources.map((resource) => {
    const variantLabel = formatVariantTitles(resource.variantTitles);
    return (
      <s-stack
        key={resource.id}
        direction="inline"
        alignItems="center"
        justifyContent="space-between"
        gap="base"
      >
        <s-stack direction="inline" alignItems="center" gap="small">
          {resource.imageUrl ? (
            <s-thumbnail src={resource.imageUrl} alt={resource.title || resource.id} size="small" />
          ) : null}
          <s-stack gap="none">
            <s-link href={adminPath(resource.id, resourceKind)} target="_blank">
              {resource.title || resource.id}
            </s-link>
            {variantLabel ? <s-text color="subdued">{variantLabel}</s-text> : null}
          </s-stack>
        </s-stack>
        <s-button
          type="button"
          variant="tertiary"
          accessibilityLabel={translate("search.remove")}
          onClick={() => onRemove(resource.id)}
        >
          <s-icon type="x-circle" />
        </s-button>
      </s-stack>
    );
  });
}

function fieldHandlers(apply) {
  const handle = (event) => apply(event.currentTarget.value);
  return {onChange: handle, onInput: handle};
}

function selectedChoice(event) {
  const values = event.currentTarget.values;
  if (Array.isArray(values) && values.length > 0) return values[0];
  return event.currentTarget.value;
}

function isChecked(event) {
  const checked = event.currentTarget.checked;
  return checked === true || checked === "true";
}

function asList(selection) {
  if (!selection) return null;
  if (Array.isArray(selection)) return selection;
  if (Array.isArray(selection.selection)) return selection.selection;
  return null;
}

function normalizeProduct(product) {
  const variants = (product.variants || []).filter((variant) => variant?.id);
  const totalVariants = Number(product.totalVariants) || 0;
  const allSelected =
    Boolean(product.hasOnlyDefaultVariant) ||
    variants.length === 0 ||
    (totalVariants > 0 && variants.length >= totalVariants);

  return {
    id: product.id,
    title: product.title || "",
    imageUrl:
      product.images?.[0]?.originalSrc || variants[0]?.image?.originalSrc || "",
    variantIds: allSelected ? [] : variants.map((variant) => variant.id),
    variantTitles: allSelected
      ? []
      : variants.map((variant) => variant.title).filter(Boolean),
  };
}

function normalizeCollection(collection) {
  return {
    id: collection.id,
    title: collection.title || "",
    imageUrl: collection.image?.originalSrc || "",
  };
}

function formatVariantTitles(titles) {
  if (!titles?.length) return "";
  if (titles.length <= 3) return titles.join(", ");
  return `${titles.slice(0, 3).join(", ")} +${titles.length - 3}`;
}

function adminPath(id, resourceKind) {
  const numericId = String(id).split("/").pop();
  return `shopify://admin/${resourceKind}/${numericId}`;
}

function validateForm(form, translate) {
  const errors = {};
  validateGroup(errors, "buys", form.customerBuys, translate);
  validateGroup(errors, "gets", form.customerGets, translate);

  if (form.discountValue.type === "fixed") {
    if (toCents(form.discountValue.fixedAmount) < 1) {
      errors.fixedAmount = translate("errors.amount");
    }
  } else if (form.discountValue.type === "percentage") {
    const percentage = Number(form.discountValue.percentage);
    if (!Number.isFinite(percentage) || percentage <= 0 || percentage > 100) {
      errors.percentage = translate("errors.percentage");
    }
  } else {
    errors.percentage = translate("errors.percentage");
  }

  if (form.limitUses && invalidQuantity(form.maxUsesPerOrder)) {
    errors.maxUses = translate("errors.maxUses");
  }

  return errors;
}

function validateGroup(errors, prefix, group, translate) {
  if (invalidQuantity(group.quantity)) {
    errors[`${prefix}Quantity`] = translate("errors.quantity");
  }

  const resources = group.itemType === "collections" ? group.collections : group.products;
  if (resources.length === 0) {
    errors[`${prefix}Items`] =
      group.itemType === "collections"
        ? translate("errors.collections")
        : translate("errors.products");
  } else if (resources.length > MAX_ITEMS) {
    errors[`${prefix}Items`] =
      group.itemType === "collections"
        ? translate("errors.tooManyCollections")
        : translate("errors.tooManyProducts");
  }
}

function invalidQuantity(value) {
  const number = Number(value);
  return !Number.isInteger(number) || number < 1;
}

function toCents(amount) {
  const value =
    typeof amount === "number"
      ? amount
      : Number(String(amount ?? "").replace(/,/g, "").trim());
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100);
}

function emptyGroup() {
  return {
    quantity: "",
    itemType: "products",
    purchaseType: "ONE_TIME",
    products: [],
    collections: [],
  };
}

function emptyForm() {
  return {
    customerBuys: emptyGroup(),
    customerGets: emptyGroup(),
    discountValue: {type: "percentage", percentage: "", fixedAmount: ""},
    limitUses: false,
    maxUsesPerOrder: "",
  };
}

function formFromMetafield(raw) {
  let parsed;
  try {
    parsed = raw ? JSON.parse(raw) : null;
  } catch {
    return emptyForm();
  }
  if (!parsed?.customerGets || !parsed?.discountValue) {
    return emptyForm();
  }

  const uses = Number(parsed.maxUsesPerOrder);
  const limitUses = Number.isInteger(uses) && uses >= 1;

  return {
    customerBuys: parsed.customerBuys ? groupFromSaved(parsed.customerBuys) : emptyGroup(),
    customerGets: groupFromSaved(parsed.customerGets),
    discountValue: {
      type: parsed.discountValue.type === "fixed" ? "fixed" : "percentage",
      percentage: displayPercentage(parsed.discountValue.percentage),
      fixedAmount: displayAmount(parsed.discountValue.fixedAmount),
    },
    limitUses,
    maxUsesPerOrder: limitUses ? String(uses) : "",
  };
}

function groupFromSaved(group) {
  return {
    quantity: displayQuantity(group.quantity),
    itemType: group.itemType === "collections" ? "collections" : "products",
    purchaseType: normalizePurchaseType(group.purchaseType),
    products: asArray(group.products).map(savedProduct).filter((product) => product.id),
    collections: asArray(group.collections)
      .map(savedCollection)
      .filter((collection) => collection.id),
  };
}

function formToMetafield(form) {
  const buysCollections =
    form.customerBuys.itemType === "collections" ? form.customerBuys.collections : [];
  const getsCollections =
    form.customerGets.itemType === "collections" ? form.customerGets.collections : [];

  return {
    buysCollectionIds: buysCollections.map((collection) => collection.id),
    getsCollectionIds: getsCollections.map((collection) => collection.id),
    customerBuys: {
      requirement: "quantity",
      quantity: Number(form.customerBuys.quantity) || 0,
      amount: "0",
      itemType: form.customerBuys.itemType,
      purchaseType: form.customerBuys.purchaseType,
      products: form.customerBuys.products.map(serializeProduct),
      collections: form.customerBuys.collections.map(serializeCollection),
    },
    customerGets: {
      quantity: Number(form.customerGets.quantity) || 0,
      itemType: form.customerGets.itemType,
      purchaseType: form.customerGets.purchaseType,
      products: form.customerGets.products.map(serializeProduct),
      collections: form.customerGets.collections.map(serializeCollection),
    },
    discountValue: {
      type: form.discountValue.type,
      percentage: Number(form.discountValue.percentage) || 0,
      fixedAmount: form.discountValue.fixedAmount || "0",
    },
    maxUsesPerOrder: form.limitUses ? Number(form.maxUsesPerOrder) : null,
  };
}

function serializeProduct(product) {
  return {
    id: product.id,
    title: product.title || "",
    imageUrl: product.imageUrl || "",
    variantIds: product.variantIds || [],
    variantTitles: product.variantTitles || [],
  };
}

function serializeCollection(collection) {
  return {
    id: collection.id,
    title: collection.title || "",
    imageUrl: collection.imageUrl || "",
  };
}

function savedProduct(product) {
  if (!product?.id) return {id: ""};
  return {
    id: product.id,
    title: product.title || "",
    imageUrl: product.imageUrl || "",
    variantIds: asArray(product.variantIds).filter(Boolean),
    variantTitles: asArray(product.variantTitles).filter(Boolean),
  };
}

function savedCollection(collection) {
  if (!collection?.id) return {id: ""};
  return {
    id: collection.id,
    title: collection.title || "",
    imageUrl: collection.imageUrl || "",
  };
}

function displayQuantity(value) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) return "";
  return String(number);
}

function displayAmount(value) {
  if (toCents(value) < 1) return "";
  return String(value);
}

function displayPercentage(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0 || number > 100) return "";
  return String(number);
}

function normalizePurchaseType(value) {
  if (value === "SUBSCRIPTION" || value === "BOTH" || value === "ONE_TIME") return value;
  return "ONE_TIME";
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}
