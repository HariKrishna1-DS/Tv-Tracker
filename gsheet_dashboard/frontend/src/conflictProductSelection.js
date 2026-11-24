import React from 'react';
import * as jsx from 'react/jsx-runtime';

function productsInColumn(row) {
  return String(row.Products || row.Product || '').split(',').map(product => product.trim()).filter(Boolean);
}

function productForCandidate(candidate, columnProducts) {
  return candidate.product?.trim() || (columnProducts.length === 1 ? columnProducts[0] : '');
}

export function conflictProductChoices(rows, candidatesFor) {
  const products = new Set();
  for (const row of rows) {
    const names = productsInColumn(row);
    const rowProducts = names.length ? names : candidatesFor(row).map(candidate => candidate.product?.trim());
    for (const product of rowProducts) if (product) products.add(product);
  }
  return [...products].sort((a, b) => a.localeCompare(b));
}

export function selectConflictProducts(rows, products, previous, candidatesFor, toIndianTime) {
  const selections = { ...previous };
  const wanted = new Set(products);
  let selected = 0;
  let needsReview = 0;

  for (const row of rows) {
    const order = row['Order Number'];
    if (!order) continue;
    const columnProducts = productsInColumn(row);
    const candidates = candidatesFor(row).map(candidate => ({ ...candidate, product: productForCandidate(candidate, columnProducts) }));
    const original = selections[order] || [];
    const existing = original.filter(entry => {
      const candidate = candidates.find(item => item.time_central === entry.time_central && item.product?.trim());
      const product = entry.product?.trim() || candidate?.product.trim();
      return !product || wanted.has(product);
    });
    if (existing.length !== original.length) {
      if (existing.length) selections[order] = existing;
      else delete selections[order];
    }
    const matches = candidates.filter(candidate =>
      wanted.has(candidate.product?.trim()) && candidate.time_central
    );
    if (!matches.length) continue;

    const capacity = String(row['S.No'] ?? '').split(',').length;
    const byProduct = capacity > 1;
    const choices = new Map();
    for (const candidate of matches) {
      const product = candidate.product.trim();
      if (!choices.has(product)) choices.set(product, []);
      choices.get(product).push(candidate);
    }
    const next = [...existing];
    let review = false;
    let matched = false;
    for (const candidates of choices.values()) {
      if (existing.some(entry => candidates.some(candidate => entry.time_central === candidate.time_central))) {
        matched = true;
        continue;
      }
      if (candidates.length !== 1 || next.length >= capacity || (!byProduct && choices.size > 1)) {
        review = true;
        continue;
      }
      const candidate = candidates[0];
      const time = candidate.time_ist || toIndianTime(candidate.time_central);
      if (!time || next.some(entry => entry.time_central === candidate.time_central)) {
        review = true;
        continue;
      }
      next.push({
        time_central: candidate.time_central,
        time_ist: time,
        source_file: candidate.files_str || (candidate.files || []).join(', '),
        product: candidate.product,
        byProduct,
      });
      matched = true;
    }
    if (next.length > existing.length) selections[order] = next;
    if (matched) selected++;
    if (review) needsReview++;
  }
  return { selections, selected, needsReview };
}

export function selectedConflictProducts(rows, selections, candidatesFor) {
  const products = new Set();
  for (const row of rows) {
    const selectedTimes = new Set((selections[row['Order Number']] || []).map(entry => entry.time_central));
    if (!selectedTimes.size) continue;
    const columnProducts = productsInColumn(row);
    for (const candidate of candidatesFor(row)) {
      const product = productForCandidate(candidate, columnProducts);
      if (product && selectedTimes.has(candidate.time_central)) products.add(product);
    }
  }
  return [...products];
}

export function ConflictProductPicker({ products, selectedProducts, disabled, onApply }) {
  const [search, setSearch] = React.useState('');
  const [checked, setChecked] = React.useState([]);
  const picker = React.useRef(null);
  const chosen = products.filter(product => checked.includes(product));
  const shown = products.filter(product => product.toLowerCase().includes(search.trim().toLowerCase()));
  const shownSet = new Set(shown);
  const shownChecked = checked.filter(product => shownSet.has(product)).length;

  function close() {
    picker.current.open = false;
    picker.current.querySelector('summary').focus();
  }

  React.useEffect(() => {
    const dismiss = event => {
      if (picker.current && !picker.current.contains(event.target)) picker.current.open = false;
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, []);

  return jsx.jsxs('details', {
    className: 'conflict-bulk-product', ref: picker,
    onToggle: event => {
      if (event.target !== picker.current || !picker.current.open) return;
      setChecked(selectedProducts);
      setSearch('');
      const list = picker.current.querySelector('[aria-label="Products"]');
      if (list) list.scrollTop = 0;
    },
    onKeyDown: event => {
      if (event.key === 'Escape' && picker.current.open) {
        event.stopPropagation();
        close();
      }
    },
    children: [
      jsx.jsx('summary', { children: 'Select products' }),
      jsx.jsxs('div', { className: 'conflict-product-menu', children: [
        jsx.jsx('input', { type: 'search', 'aria-label': 'Search products', placeholder: 'Search products', value: search, onChange: event => setSearch(event.target.value) }),
        jsx.jsx('div', { className: 'conflict-product-choices', children: jsx.jsxs('label', { children: [
          jsx.jsx('input', {
            type: 'checkbox',
            checked: shown.length > 0 && shownChecked === shown.length,
            disabled: !shown.length,
            ref: input => { if (input) input.indeterminate = shownChecked > 0 && shownChecked < shown.length; },
            onChange: event => {
              const select = event.target.checked;
              setChecked(previous => select ? [...new Set([...previous, ...shown])] : previous.filter(product => !shownSet.has(product)));
            },
          }),
          'Select all',
        ] }) }),
        jsx.jsx('div', { className: 'conflict-product-choices', role: 'group', 'aria-label': 'Products', children: shown.length ? shown.map(product => jsx.jsxs('label', { children: [
          jsx.jsx('input', { type: 'checkbox', checked: checked.includes(product), onChange: event => {
            const isChecked = event.target.checked;
            setChecked(previous => isChecked ? [...previous, product] : previous.filter(item => item !== product));
          } }), product,
        ] }, product)) : jsx.jsx('p', { children: 'No matching products.' }) }),
        jsx.jsxs('div', { className: 'conflict-product-actions', children: [
          jsx.jsx('button', { type: 'button', className: 'secondary', disabled: !checked.length, onClick: () => setChecked([]), children: 'Clear' }),
          jsx.jsx('button', { type: 'button', className: 'primary', disabled: disabled || (!chosen.length && !selectedProducts.length), onClick: () => {
            onApply(chosen);
            close();
          }, children: chosen.length ? `Apply (${chosen.length})` : 'Apply' }),
        ] }),
      ] }),
    ],
  });
}
