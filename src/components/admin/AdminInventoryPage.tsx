import * as React from 'react';
import { useState } from 'react';
import { useInventory } from '../../hooks/useInventory';
import { describeApiError } from '../../services/api/client';
import { Panel, Spinner, ErrorNote, EmptyState, buttonClass, ghostButtonClass, inputClass } from './AdminShell';

/**
 * Inventory administration: add, adjust stock, archive, and bulk import.
 *
 * Stock edits go to the server, which rejects a negative result — the input
 * is a convenience, not the rule.
 */

interface NewItemForm {
  skuId: string;
  productName: string;
  productCategory: string;
  availableQuantity: string;
  unitSalesPrice: string;
  costPrice: string;
  gstRate: string;
}

const EMPTY_FORM: NewItemForm = {
  skuId: '',
  productName: '',
  productCategory: '',
  availableQuantity: '0',
  unitSalesPrice: '',
  costPrice: '',
  gstRate: '18',
};

/**
 * Parses pasted CSV into item payloads.
 *
 * Returns per-row errors rather than throwing on the first bad line, so a
 * user importing 200 rows sees everything that needs fixing at once.
 */
export function parseInventoryCsv(text: string): {
  items: Record<string, unknown>[];
  errors: { line: number; message: string }[];
} {
  const lines = text.trim().split(/\r?\n/).filter(line => line.trim().length > 0);
  const items: Record<string, unknown>[] = [];
  const errors: { line: number; message: string }[] = [];

  if (lines.length === 0) return { items, errors };

  const header = lines[0].split(',').map(h => h.trim().toLowerCase());
  const required = ['sku_id', 'product_name'];
  const missing = required.filter(column => !header.includes(column));

  if (missing.length > 0) {
    errors.push({ line: 1, message: `Missing required column(s): ${missing.join(', ')}` });
    return { items, errors };
  }

  const indexOf = (name: string) => header.indexOf(name);

  lines.slice(1).forEach((line, offset) => {
    const lineNumber = offset + 2;
    const cells = line.split(',').map(c => c.trim());

    const skuId = cells[indexOf('sku_id')];
    const productName = cells[indexOf('product_name')];

    if (!skuId || !productName) {
      errors.push({ line: lineNumber, message: 'sku_id and product_name are both required.' });
      return;
    }

    const numeric = (column: string, fallback?: number) => {
      const index = indexOf(column);
      if (index === -1 || !cells[index]) return fallback;
      const value = Number(cells[index]);
      if (!Number.isFinite(value) || value < 0) {
        errors.push({ line: lineNumber, message: `${column} must be a non-negative number.` });
        return fallback;
      }
      return value;
    };

    items.push({
      skuId,
      productName,
      productCategory: cells[indexOf('product_category')] || undefined,
      oemBrand: cells[indexOf('oem_brand')] || undefined,
      availableQuantity: numeric('available_quantity', 0),
      unitSalesPrice: numeric('unit_sales_price'),
      costPrice: numeric('cost_price'),
      gstRate: numeric('gst_rate', 18),
    });
  });

  return { items, errors };
}

export const AdminInventoryPage: React.FC = () => {
  const [search, setSearch] = useState('');
  const { inventory, total, loading, error, isEmpty, create, setStock, archive, reload } = useInventory({
    search: search || undefined,
    includeInactive: true,
  });

  const [form, setForm] = useState<NewItemForm>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [csv, setCsv] = useState('');
  const [importReport, setImportReport] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setFormError(null);
    try {
      await create({
        skuId: form.skuId.trim(),
        productName: form.productName.trim(),
        productCategory: form.productCategory.trim() || undefined,
        availableQuantity: Number(form.availableQuantity || 0),
        unitSalesPrice: form.unitSalesPrice ? Number(form.unitSalesPrice) : undefined,
        costPrice: form.costPrice ? Number(form.costPrice) : undefined,
        gstRate: form.gstRate ? Number(form.gstRate) : undefined,
      });
      setForm(EMPTY_FORM);
    } catch (err) {
      setFormError(describeApiError(err));
    }
  };

  const runImport = async () => {
    setImportReport(null);
    const { items, errors } = parseInventoryCsv(csv);

    if (errors.length > 0) {
      setImportReport(
        `${errors.length} row(s) rejected:\n${errors.map(e => `Line ${e.line}: ${e.message}`).join('\n')}`
      );
      if (items.length === 0) return;
    }

    let imported = 0;
    const failures: string[] = [];
    for (const item of items) {
      try {
        await create(item);
        imported += 1;
      } catch (err) {
        failures.push(`${item.skuId}: ${describeApiError(err)}`);
      }
    }

    setImportReport(
      [
        `${imported} item(s) imported.`,
        failures.length ? `${failures.length} failed:\n${failures.join('\n')}` : '',
        errors.length ? `${errors.length} row(s) skipped during parsing.` : '',
      ]
        .filter(Boolean)
        .join('\n')
    );
    setCsv('');
    await reload();
  };

  return (
    <div className="space-y-6">
      {error && <ErrorNote message={error} />}
      {formError && <ErrorNote message={formError} />}

      <Panel title="Add an item" subtitle="SKU codes are unique within your workspace.">
        <form onSubmit={submit} className="grid sm:grid-cols-3 lg:grid-cols-4 gap-3">
          <input required value={form.skuId} onChange={e => setForm({ ...form, skuId: e.target.value })} placeholder="SKU code" className={inputClass} />
          <input required value={form.productName} onChange={e => setForm({ ...form, productName: e.target.value })} placeholder="Product name" className={inputClass} />
          <input value={form.productCategory} onChange={e => setForm({ ...form, productCategory: e.target.value })} placeholder="Category" className={inputClass} />
          <input type="number" min="0" value={form.availableQuantity} onChange={e => setForm({ ...form, availableQuantity: e.target.value })} placeholder="Quantity" className={inputClass} />
          <input type="number" min="0" step="0.01" value={form.unitSalesPrice} onChange={e => setForm({ ...form, unitSalesPrice: e.target.value })} placeholder="Unit sales price" className={inputClass} />
          <input type="number" min="0" step="0.01" value={form.costPrice} onChange={e => setForm({ ...form, costPrice: e.target.value })} placeholder="Cost price" className={inputClass} />
          <input type="number" min="0" max="100" step="0.01" value={form.gstRate} onChange={e => setForm({ ...form, gstRate: e.target.value })} placeholder="GST %" className={inputClass} />
          <button type="submit" className={buttonClass}>Add item</button>
        </form>
      </Panel>

      <Panel title="Bulk import" subtitle="CSV with a header row. Required columns: sku_id, product_name.">
        <textarea
          value={csv}
          onChange={e => setCsv(e.target.value)}
          rows={5}
          placeholder="sku_id,product_name,product_category,available_quantity,unit_sales_price,gst_rate"
          className={`${inputClass} font-mono text-[11px]`}
        />
        <div className="flex items-center gap-3 mt-3">
          <button onClick={() => void runImport()} disabled={!csv.trim()} className={buttonClass}>
            Import
          </button>
          {importReport && (
            <pre className="text-[10px] text-slate-400 whitespace-pre-wrap flex-1">{importReport}</pre>
          )}
        </div>
      </Panel>

      <Panel
        title="Catalogue"
        subtitle={`${total} item(s)`}
        action={
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search SKU, name, category"
            className={`${inputClass} w-64`}
          />
        }
      >
        {loading && inventory.length === 0 ? (
          <Spinner label="Loading inventory" />
        ) : isEmpty ? (
          <EmptyState
            title="No inventory yet"
            message="Add items individually or paste a CSV above. Discovery and tender analysis both need inventory before they can qualify anything."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="text-[9px] font-black text-slate-500 uppercase tracking-[0.2em]">
                  <th className="pb-3 pr-4">SKU</th>
                  <th className="pb-3 pr-4">Product</th>
                  <th className="pb-3 pr-4">Category</th>
                  <th className="pb-3 pr-4">Stock</th>
                  <th className="pb-3 pr-4">Unit price</th>
                  <th className="pb-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {inventory.map(item => (
                  <tr key={item.skuId} className={`border-t border-slate-800/60 ${item.isActive ? '' : 'opacity-50'}`}>
                    <td className="py-3 pr-4 text-[11px] text-slate-400 font-mono">{item.skuId}</td>
                    <td className="py-3 pr-4 text-[12px] text-slate-200">{item.productName}</td>
                    <td className="py-3 pr-4 text-[11px] text-slate-500">{item.productCategory || '—'}</td>
                    <td className="py-3 pr-4">
                      <input
                        type="number"
                        min="0"
                        defaultValue={item.availableQuantity}
                        onBlur={e => {
                          const next = Number(e.target.value);
                          if (next !== item.availableQuantity) void setStock(item.skuId, next);
                        }}
                        className="bg-slate-950 border border-slate-800 rounded-lg px-2 py-1 text-[11px] text-white w-24 tabular-nums"
                      />
                    </td>
                    <td className="py-3 pr-4 text-[11px] text-slate-300 tabular-nums">
                      {item.unitSalesPrice ? `₹${item.unitSalesPrice.toLocaleString('en-IN')}` : '—'}
                    </td>
                    <td className="py-3 text-right">
                      <button
                        onClick={() => {
                          if (window.confirm(`Archive ${item.skuId}? It stops being matched against tenders.`)) {
                            void archive(item.skuId);
                          }
                        }}
                        className={ghostButtonClass}
                      >
                        Archive
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
};
